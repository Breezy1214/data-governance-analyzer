from time import perf_counter

import pytest
from fastapi.testclient import TestClient
from helpers import sample_payload

from app.auth import require_session
from app.config import Settings
from app.logging_config import JsonFormatter
from app.main import app, create_app

client = TestClient(app)


@pytest.fixture(autouse=True)
def authenticated_scoring_contract():
    # These existing tests exercise scoring. Authentication uses separate, non-overridden apps in test_auth.py.
    app.dependency_overrides[require_session] = lambda: {"user": {"id": "scoring-test"}}
    yield
    app.dependency_overrides.clear()


def preflight(test_client, origin):
    return test_client.options(
        "/assessments",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )


def test_health_and_version():
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/version").json()["version"] == "0.1.0"


def test_assessment_returns_transparent_score_with_attribution():
    response = client.post("/assessments", json=sample_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["score"] == 38
    assert body["level"] == "MEDIUM"
    assert body["schemaVersion"] == "2.0"
    assert body["rulesVersion"] == "1.0"
    assert body["mappingVersion"] == "1.1"
    assert body["mappingApprovalStatus"] == "approved"
    assert {item["text"] for item in body["generalSafeguards"]} <= {
        item["action"] for item in body["recommendationDetails"]
    }
    matching = next(item for item in body["karlsgateRecommendations"] if item["id"] == "PROTECTED_MATCHING")
    assert matching["conditionId"] == "EXTERNAL_AND_RAW_OR_MATCHING"
    assert matching["factorIds"] == ["EXTERNAL_ACCESS", "PURPOSE_MATCHING"]
    assert "Protected matching" in body["capabilities"]
    assert {factor["ruleId"] for factor in body["factors"]} == {
        "DATA_SENSITIVITY_DIRECT",
        "EXTERNAL_ACCESS",
        "PURPOSE_MATCHING",
    }
    assert "recommendations" not in body
    assert [item["priority"] for item in body["recommendationDetails"]] == list(
        range(1, len(body["recommendationDetails"]) + 1)
    )
    assert all(item["rationale"] and item["riskFactorIds"] for item in body["recommendationDetails"])


def test_high_risk_regulated_use_includes_limitations():
    response = client.post(
        "/assessments",
        json=sample_payload(
            dataTypes=["health", "financial"],
            rawExchange="yes",
            dataMovement="yes",
            combined="yes",
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


def test_unsupported_purpose_is_rejected():
    response = client.post("/assessments", json=sample_payload(purpose="unsupported-value"))
    assert response.status_code == 422


def test_unsupported_extra_field_is_rejected():
    response = client.post("/assessments", json=sample_payload(unexpectedField="value"))
    assert response.status_code == 422


def test_oversized_request_is_rejected_before_validation():
    responses = [
        client.post("/assessments", content=b"x" * 20_000),
        client.post("/assessments", content=iter([b"x" * 10_000, b"x" * 10_000])),
    ]

    assert [response.status_code for response in responses] == [413, 413]
    assert all(response.json()["error"] == "request_too_large" for response in responses)


@pytest.mark.parametrize("origin", ["http://localhost:3000", "http://127.0.0.1:3000"])
def test_development_frontend_origins_can_post(origin):
    response = preflight(client, origin)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize(
    ("origin", "allowed"),
    [
        ("https://data-governance-analyzer-git-dev-team.vercel.app", True),
        ("https://data-governance-analyzer-abc123-team.vercel.app", True),
        ("https://evil.example/data-governance-analyzer-x-team.vercel.app", False),
        ("https://other-project-team.vercel.app", False),
    ],
)
def test_preview_origin_regex_controls_cors(origin, allowed):
    settings = Settings(allowed_origin_regex=r"https://data-governance-analyzer-[a-z0-9-]+-team\.vercel\.app")
    response = preflight(TestClient(create_app(settings)), origin)

    assert (response.headers.get("access-control-allow-origin") == origin) is allowed


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
