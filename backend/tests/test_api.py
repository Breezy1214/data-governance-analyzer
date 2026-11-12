from time import perf_counter

import pytest
from fastapi.testclient import TestClient
from helpers import sample_payload

from app.auth import require_session
from app.logging_config import JsonFormatter
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def authenticated_scoring_contract():
    # These existing tests exercise scoring. Authentication uses separate, non-overridden apps in test_auth.py.
    app.dependency_overrides[require_session] = lambda: {"sub": "scoring-test"}
    yield
    app.dependency_overrides.clear()


def test_health_and_version():
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/version").json()["version"] == "0.1.0"


def test_assessment_returns_transparent_score():
    response = client.post("/assessments", json=sample_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["score"] == 28
    assert body["level"] == "LOW"
    assert body["schemaVersion"] == "3.0"
    assert body["rulesVersion"] == "2.0"
    assert body["mappingVersion"] == "2.0"
    assert body["mappingApprovalStatus"] == "approved"
    assert body["sourcesCheckedOn"] == "2026-11-04"
    assert {factor["ruleId"] for factor in body["factors"]} == {
        "DATA_SENSITIVITY_DIRECT",
        "PARTICIPANTS_ONE",
        "PURPOSE_OVERLAP",
    }
    for retired in ("recommendationDetails", "generalSafeguards", "capabilities"):
        assert retired not in body
    assert [item["priority"] for item in body["recommendations"]] == list(range(1, len(body["recommendations"]) + 1))
    assert all(item["rationale"] and item["action"] for item in body["recommendations"])


def test_response_returns_the_answers_it_accepted_for_saving():
    # The frontend saves these, not the raw request, so defaults such as schemaVersion are filled in.
    body = client.post("/assessments", json=sample_payload()).json()
    assert body["answers"] == {**sample_payload(), "schemaVersion": "3.0"}


def test_high_risk_regulated_use_includes_limitations():
    response = client.post(
        "/assessments",
        json=sample_payload(
            dataTypes=["health", "financial"],
            participants="multiplePartners",
            identifierProtection="cleartext",
            custodyChange="yes",
            environmentControl="thirdParty",
            reusableKeys="yes",
            combined="yes",
            retainedArtifacts="yes",
            secondaryUse="yes",
            purpose="ai",
        ),
    )
    body = response.json()
    assert body["score"] == 100
    assert body["level"] == "HIGH"
    assert len(body["limitations"]) == 2


def test_invalid_input_returns_clear_client_error_without_echoing_input():
    oversized = "sensitive " * 120
    response = client.post("/assessments", json=sample_payload(description=oversized, dataTypes=[]))
    assert response.status_code == 422
    body = response.json()
    assert body["error"] == "invalid_input"
    assert "requestId" in body
    assert "body" in body["fields"]
    assert "dataTypes" in body["fields"]
    # The invalid free-text value must never be echoed back to the client.
    assert "sensitive" not in response.text


def test_free_text_description_is_never_accepted_or_echoed():
    # The description stays in the browser; personal details in it must never reach this service.
    response = client.post(
        "/assessments",
        json=sample_payload(description="Jane Doe, jane@example.com, SSN 123-45-6789"),
    )
    assert response.status_code == 422
    assert "jane" not in response.text.lower()
    assert "123-45-6789" not in response.text


def test_oversized_request_is_rejected_before_validation():
    responses = [
        client.post("/assessments", content=b"x" * 20_000),
        client.post("/assessments", content=iter([b"x" * 10_000, b"x" * 10_000])),
    ]

    assert [response.status_code for response in responses] == [413, 413]
    assert all(response.json()["error"] == "request_too_large" for response in responses)


def test_user_controlled_extra_field_name_is_not_echoed_or_logged(caplog):
    submitted_field_name = "person@example.com"

    with caplog.at_level("WARNING", logger="governance.scoring"):
        response = client.post(
            "/assessments",
            json=sample_payload(**{submitted_field_name: "sensitive value"}),
        )

    assert response.status_code == 422
    assert response.json()["fields"] == ["body"]
    assert submitted_field_name not in response.text
    assert submitted_field_name not in caplog.text


def test_assessment_responses_are_not_cached():
    response = client.post("/assessments", json=sample_payload())
    assert response.headers["cache-control"] == "no-store"


def test_scoring_logs_exclude_questionnaire_input(caplog):
    with caplog.at_level("INFO", logger="governance.scoring"):
        client.post("/assessments", json=sample_payload(dataTypes=["health"]))
    logged = "\n".join(JsonFormatter().format(record) for record in caplog.records)
    assert "assessment_scored" in logged
    assert '"level": "INFO"' in logged
    assert '"riskLevel": "MEDIUM"' in logged
    assert "health" not in logged


def test_assessment_response_time_is_under_two_seconds_for_demo_conditions():
    """25 sequential in-process requests model the single-user demo workload."""
    durations = []
    for _ in range(25):
        started = perf_counter()
        response = client.post("/assessments", json=sample_payload())
        durations.append(perf_counter() - started)
        assert response.status_code == 200

    ordered = sorted(durations)
    p95 = ordered[int(len(ordered) * 0.95) - 1]
    maximum = max(durations)
    print(f"assessment latency: p95={p95 * 1000:.2f}ms max={maximum * 1000:.2f}ms requests={len(durations)}")
    assert maximum < 2.0, f"slowest assessment took {maximum:.3f}s; target is under 2.000s"
