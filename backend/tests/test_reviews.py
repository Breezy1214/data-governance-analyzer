from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from psycopg import DatabaseError
from psycopg.errors import (
    ForeignKeyViolation,
    InsufficientPrivilege,
    InternalError,
    InvalidParameterValue,
    SerializationFailure,
)

from app.auth import require_session
from app.config import Settings
from app.main import create_app
from app.register.routes import register_store
from app.register.store import AssessmentNotFound

USER = "00000000-0000-4000-8000-000000000001"
VERSION = "00000000-0000-4000-8000-000000000002"


class OwnRole(DatabaseError):
    sqlstate = "RV001"
DECISION = {"action": "transition", "versionId": VERSION, "workspaceId": USER,
            "status": "approved", "expectedStatus": "in_review", "note": "Controls reviewed"}


@pytest.fixture
def fixture():
    app = create_app(Settings(supabase_url="https://example.supabase.co"))
    store = Mock()
    store.review_workspaces.return_value = []
    store.review_queue.return_value = []
    app.dependency_overrides[register_store] = lambda: store
    app.dependency_overrides[require_session] = lambda: {"sub": USER}
    return TestClient(app), store, app


def test_uses_verified_identity_and_passes_expected_state(fixture):
    client, store, _ = fixture
    response = client.post("/reviews", json=DECISION)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    user, version, _, status, note, expected = store.transition.call_args.args
    assert (user, str(version), status, note, expected) == (USER, VERSION, "approved", "Controls reviewed", "in_review")


def test_routes_each_action_to_its_own_operation(fixture):
    client, store, _ = fixture
    assert client.post("/reviews", json={"action": "create", "name": " Privacy team "}).status_code == 200
    store.create_workspace.assert_called_once_with(USER, "Privacy team")
    member = {"action": "member", "workspaceId": VERSION, "userId": USER, "role": None}
    assert client.post("/reviews", json=member).status_code == 200
    assert store.set_member.call_args.args[3] is None
    store.transition.assert_not_called()


@pytest.mark.parametrize("change", [{"actor_id": VERSION}, {"status": "draft"}, {"note": "x" * 2001},
                                    {"versionId": "invalid"}, {"action": "unknown"}])
def test_rejects_invalid_or_spoofed_requests(fixture, change):
    client, store, _ = fixture
    assert client.post("/reviews", json={**DECISION, **change}).status_code == 422
    store.transition.assert_not_called()


@pytest.mark.parametrize("error,status", [(InsufficientPrivilege, 403), (SerializationFailure, 409),
                                         (InvalidParameterValue, 400), (ForeignKeyViolation, 400),
                                         (InternalError, 503), (OwnRole, 400)])
def test_safe_database_permission_and_conflict_responses(fixture, error, status):
    client, store, _ = fixture
    store.transition.side_effect = error("PRIVATE database detail")
    response = client.post("/reviews", json=DECISION)
    assert response.status_code == status
    assert "PRIVATE" not in response.text


def test_reads_are_scoped_and_missing_records_are_not_disclosed(fixture):
    client, store, _ = fixture
    for view in ("workspaces", "queue"):
        response = client.get(f"/reviews/{view}")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        getattr(store, f"review_{view}").assert_called_with(USER)
    store.review_queue.return_value = [{"id": VERSION, "assessment_id": USER, "version": 2, "score": 40, "risk_level": "MEDIUM",
                                        "answers": {"purpose": "x"}, "created_at": "2026-11-18T09:00:00Z",
                                        "workspace": "Privacy team"}]
    entry = client.get("/reviews/queue").json()[0]
    assert (entry["assessmentId"], entry["level"], entry["workspace"]) == (USER, "MEDIUM", "Privacy team")
    store.review_context.side_effect = AssessmentNotFound
    assert client.get(f"/reviews/versions/{VERSION}").status_code == 404


def test_requires_authentication_for_every_review_route(fixture):
    client, store, app = fixture
    del app.dependency_overrides[require_session]
    assert client.post("/reviews", json=DECISION).status_code == 401
    for route in ("workspaces", "queue", f"versions/{VERSION}"):
        assert client.get(f"/reviews/{route}").status_code == 401
    assert store.method_calls == []

