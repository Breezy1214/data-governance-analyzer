import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from helpers import sample_payload

from app.auth import require_session
from app.config import Settings
from app.main import create_app
from app.rate_limit import SlidingWindowLimiter

SCENARIOS = json.loads(
    (Path(__file__).resolve().parents[2] / "frontend" / "lib" / "demo-scenarios.json").read_text()
)
SUPABASE_URL = "https://example.supabase.co"
TEST_SETTINGS = Settings(supabase_url=SUPABASE_URL, demo_rate_per_client=3, demo_rate_total=5)


@pytest.fixture
def client():
    return TestClient(create_app(Settings(supabase_url=SUPABASE_URL, demo_rate_per_client=1000, demo_rate_total=1000)))


def scoring_payload(scenario):
    payload = dict(scenario["input"])
    payload.pop("description")
    return payload


def test_demo_scores_without_signing_in(client):
    response = client.post("/demo/assessments", json=sample_payload())
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["score"] == 28


def test_demo_matches_the_authenticated_result(client):
    client.app.dependency_overrides[require_session] = lambda: {"sub": "scoring-test"}
    signed_in = client.post("/assessments", json=sample_payload()).json()
    demo = client.post("/demo/assessments", json=sample_payload()).json()
    signed_in.pop("assessedAt")
    demo.pop("assessedAt")
    assert demo == signed_in


def test_signed_in_endpoint_still_requires_a_token(client):
    assert client.post("/assessments", json=sample_payload()).status_code == 401


def test_demo_validates_input_like_the_signed_in_endpoint(client):
    response = client.post("/demo/assessments", json=sample_payload(dataTypes=[]))
    assert response.status_code == 422
    assert "dataTypes" in response.json()["fields"]


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[scenario["id"] for scenario in SCENARIOS])
def test_sample_scenarios_score_as_described(client, scenario):
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
