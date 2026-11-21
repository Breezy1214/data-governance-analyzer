from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from helpers import sample_payload
from psycopg import OperationalError

from app.auth import require_session
from app.config import Settings
from app.main import create_app
from app.register.routes import register_store
from app.register.store import AssessmentLocked, AssessmentNotFound

OWNER, OTHER = "00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b"


class MemoryStore:
    """Keeps each user's rows apart the way row-level security does in the database."""

    def __init__(self):
        self.rows = []
        self.fail = False

    def save(self, user_id, answers, result, assessment_id):
        if self.fail:
            raise OperationalError("database unavailable")
        if assessment_id is None:
            assessment_id = uuid4()
        elif not self._mine(user_id, assessment_id):
            raise AssessmentNotFound
        version = len(self._mine(user_id, assessment_id)) + 1
        self.rows.append({"user": user_id, "assessment_id": assessment_id, "id": uuid4(), "version": version,
                          "status": "draft", "answers": answers, "result": result,
                          "created_at": datetime.now(UTC)})
        return assessment_id, version

    def entries(self, user_id):
        latest = {}
        for row in (row for row in self.rows if row["user"] == user_id):
            latest[row["assessment_id"]] = row
        return [{**row, "version_count": row["version"], "score": row["result"]["score"],
                 "risk_level": row["result"]["level"], "saved_at": row["created_at"]} for row in latest.values()]

    def versions(self, user_id, assessment_id):
        return [{**row, "owned": True} for row in self._mine(user_id, assessment_id)]

    def delete(self, user_id, assessment_id):
        mine = self._mine(user_id, assessment_id)
        if not mine:
            raise AssessmentNotFound
        if any(row["status"] != "draft" for row in mine):
            raise AssessmentLocked
        self.rows = [row for row in self.rows if row not in mine]

    def _mine(self, user_id, assessment_id):
        return [row for row in self.rows if row["user"] == user_id and row["assessment_id"] == assessment_id]


@pytest.fixture
def store():
    return MemoryStore()


@pytest.fixture
def as_user(store):
    app = create_app(Settings(supabase_url="https://example.supabase.co"))
    app.dependency_overrides[register_store] = lambda: store
    user = {"sub": OWNER}
    app.dependency_overrides[require_session] = lambda: user

    def client_for(user_id):
        user["sub"] = user_id
        return client

    client = TestClient(app)
    return client_for


def test_saves_its_own_scoring_with_the_validated_answers(as_user, store):
    body = as_user(OWNER).post("/assessments", json=sample_payload(dataTypes=["health"])).json()

    assert body["saved"] == {"assessmentId": str(store.rows[0]["assessment_id"]), "version": 1}
    row = store.rows[0]
    assert row["user"] == OWNER
    assert row["answers"] == {**sample_payload(dataTypes=["health"]), "schemaVersion": "3.0"}
    assert row["result"]["score"] == body["score"] and row["result"]["level"] == body["level"] == "MEDIUM"
    assert "description" not in row["answers"] and "saved" not in row["result"]


def test_cannot_save_a_result_it_did_not_score(as_user, store):
    response = as_user(OWNER).post("/assessments", json={**sample_payload(), "score": 0, "level": "LOW"})
    assert response.status_code == 422
    assert store.rows == []


def test_reassessing_adds_a_version_and_keeps_the_earlier_one(as_user, store):
    client = as_user(OWNER)
    first = client.post("/assessments", json=sample_payload()).json()["saved"]
    second = client.post(f"/assessments/{first['assessmentId']}/versions",
                         json=sample_payload(combined="yes")).json()["saved"]

    assert second == {"assessmentId": first["assessmentId"], "version": 2}
    record = client.get(f"/assessments/{first['assessmentId']}").json()
    assert record["owned"] is True
    assert [(item["version"], item["answers"]["combined"]) for item in record["versions"]] == [(1, "no"), (2, "yes")]


def test_another_users_assessment_is_not_found(as_user, store):
    saved = as_user(OWNER).post("/assessments", json=sample_payload()).json()["saved"]
    other = as_user(OTHER)

    assert other.post(f"/assessments/{saved['assessmentId']}/versions", json=sample_payload()).status_code == 404
    assert other.get(f"/assessments/{saved['assessmentId']}").status_code == 404
    assert other.delete(f"/assessments/{saved['assessmentId']}").status_code == 404
    assert other.get("/assessments").json() == []
    assert len(store.rows) == 1


def test_ids_that_are_not_uuids_are_not_found_without_saving(as_user, store):
    client = as_user(OWNER)
    assert client.post("/assessments/not-an-id/versions", json=sample_payload()).status_code == 404
    assert client.get("/assessments/not-an-id").status_code == 404
    assert store.rows == []


def test_register_lists_the_latest_version(as_user):
    client = as_user(OWNER)
    saved = client.post("/assessments", json=sample_payload()).json()["saved"]
    client.post(f"/assessments/{saved['assessmentId']}/versions", json=sample_payload(dataTypes=["gov"]))

    response = client.get("/assessments")
    assert response.headers["cache-control"] == "no-store"
    [entry] = response.json()
    assert (entry["assessmentId"], entry["version"], entry["status"]) == (saved["assessmentId"], 2, "draft")


def test_delete_removes_a_draft_but_retains_a_submitted_assessment(as_user, store):
    client = as_user(OWNER)
    first = client.post("/assessments", json=sample_payload()).json()["saved"]["assessmentId"]
    second = client.post("/assessments", json=sample_payload()).json()["saved"]["assessmentId"]
    next(row for row in store.rows if row["assessment_id"] == UUID(second))["status"] = "rejected"

    assert client.delete(f"/assessments/{first}").status_code == 204
    assert client.get(f"/assessments/{first}").status_code == 404
    locked = client.delete(f"/assessments/{second}")
    assert locked.status_code == 409
    assert locked.json()["error"] == "conflict"
    assert "retained" in locked.json()["message"]


def test_a_failed_save_still_returns_the_result(as_user, store):
    store.fail = True
    response = as_user(OWNER).post("/assessments", json=sample_payload())
    assert response.status_code == 200
    assert response.json()["saved"] is None
    assert response.json()["score"] == 28


def test_demo_never_saves(as_user, store):
    client = as_user(OWNER)
    client.app.state.demo_limiter.per_client = 100
    body = client.post("/demo/assessments", json=sample_payload()).json()
    assert "saved" not in body
    assert store.rows == []


def test_without_a_database_results_are_scored_but_the_register_is_unavailable():
    app = create_app(Settings(supabase_url="https://example.supabase.co"))
    app.dependency_overrides[require_session] = lambda: {"sub": OWNER}
    client = TestClient(app)

    assert client.post("/assessments", json=sample_payload()).json()["saved"] is None
    unavailable = client.get("/assessments")
    assert unavailable.status_code == 503
    assert unavailable.json()["error"] == "register_unavailable"
