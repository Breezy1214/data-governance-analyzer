import pytest
from fastapi.testclient import TestClient
from helpers import DEMO_SCENARIOS, UNLIMITED_DEMO, sample_payload, scoring_payload

from app.auth import require_session
from app.config import Settings
from app.main import create_app
from app.rate_limit import SlidingWindowLimiter

SUPABASE_URL = "https://example.supabase.co"
TEST_SETTINGS = Settings(supabase_url=SUPABASE_URL, demo_rate_per_client=3, demo_rate_total=5)


@pytest.fixture
def client():
    return TestClient(create_app(UNLIMITED_DEMO))


def test_demo_scores_without_signing_in(client):
    response = client.post("/demo/assessments", json=sample_payload())
    assert response.status_code == 200
    assert response.json()["score"] == 28


def test_demo_matches_the_authenticated_result(client):
    client.app.dependency_overrides[require_session] = lambda: {"sub": "scoring-test"}
    signed_in = client.post("/assessments", json=sample_payload()).json()
    demo = client.post("/demo/assessments", json=sample_payload()).json()
    for body in (signed_in, demo):
        body.pop("assessedAt")
    assert signed_in.pop("saved") is None
    assert demo == signed_in


def test_sample_scenarios_score_as_described(client):
    for scenario in DEMO_SCENARIOS:
        body = client.post("/demo/assessments", json=scoring_payload(scenario)).json()
        assert body["score"] == scenario["expectedScore"]
        assert body["level"] == scenario["expectedLevel"]


def test_each_visitor_is_limited():
    limited = TestClient(create_app(TEST_SETTINGS))
    headers = {"X-Demo-Client": "203.0.113.7"}
    statuses = [limited.post("/demo/assessments", json=sample_payload(), headers=headers).status_code for _ in range(4)]
    assert statuses == [200, 200, 200, 429]
    body = limited.post("/demo/assessments", json=sample_payload(), headers=headers).json()
    assert body["error"] == "rate_limited"
    other = limited.post("/demo/assessments", json=sample_payload(), headers={"X-Demo-Client": "198.51.100.2"})
    assert other.status_code == 200


def test_rotating_client_headers_cannot_pass_the_global_cap():
    limited = TestClient(create_app(TEST_SETTINGS))
    statuses = [
        limited.post("/demo/assessments", json=sample_payload(), headers={"X-Demo-Client": f"client-{index}"}).status_code
        for index in range(6)
    ]
    assert statuses == [200] * 5 + [429]


def test_limiter_window_slides():
    now = [0.0]
    limiter = SlidingWindowLimiter(per_client=1, total=10, clock=lambda: now[0])
    assert limiter.allow("visitor")
    assert not limiter.allow("visitor")
    now[0] = 60.5
    assert limiter.allow("visitor")


def test_limiter_rejects_invalid_limits():
    with pytest.raises(ValueError):
        SlidingWindowLimiter(per_client=0, total=10)


def test_idle_clients_are_forgotten():
    now = [0.0]
    limiter = SlidingWindowLimiter(per_client=1, total=10, clock=lambda: now[0])
    assert limiter.allow("first")
    now[0] = 61.0
    assert limiter.allow("second")
    assert list(limiter._clients) == ["second"]


def test_responses_report_the_deployed_api_version():
    app = create_app(Settings(supabase_url=SUPABASE_URL, version="9.9.9"))
    app.dependency_overrides[require_session] = lambda: {"sub": "scoring-test"}
    versioned = TestClient(app)
    assert versioned.post("/demo/assessments", json=sample_payload()).json()["apiVersion"] == "9.9.9"
    assert versioned.post("/assessments", json=sample_payload()).json()["apiVersion"] == "9.9.9"
