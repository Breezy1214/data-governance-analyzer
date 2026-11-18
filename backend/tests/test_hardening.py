import pytest
from fastapi.testclient import TestClient
from helpers import sample_payload

from app.auth import require_session
from app.config import Settings
from app.main import create_app

SUPABASE_URL = "https://example.supabase.co"
DOC_ROUTES = ["/docs", "/redoc", "/openapi.json"]


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_api_docs_are_hidden_outside_local_development(environment):
    client = TestClient(create_app(Settings(supabase_url=SUPABASE_URL, environment=environment)))
    for path in DOC_ROUTES:
        assert client.get(path).status_code == 404, path


def test_api_docs_are_hidden_when_app_env_is_unset(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    settings = Settings.from_env()
    assert settings.environment == "production"
    client = TestClient(create_app(settings))
    for path in DOC_ROUTES:
        assert client.get(path).status_code == 404, path


def test_api_docs_are_served_in_local_development():
    client = TestClient(create_app(Settings(supabase_url=SUPABASE_URL, environment="development")))
    for path in DOC_ROUTES:
        assert client.get(path).status_code == 200, path


def test_signed_in_scoring_is_throttled_per_user():
    app = create_app(Settings(supabase_url=SUPABASE_URL, scoring_rate_per_user=2, scoring_rate_total=10))
    user = {"sub": "first-user"}
    app.dependency_overrides[require_session] = lambda: user
    client = TestClient(app)

    statuses = [client.post("/assessments", json=sample_payload()).status_code for _ in range(2)]
    limited = client.post("/simulations", json=sample_payload())
    assert statuses == [200, 200]
    assert limited.status_code == 429
    assert limited.json()["error"] == "rate_limited"
    assert "wait a minute" in limited.json()["message"]
    assert limited.headers["Retry-After"] == "60"

    user["sub"] = "second-user"
    assert client.post("/simulations", json=sample_payload()).status_code == 200
