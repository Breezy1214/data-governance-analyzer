import sqlite3

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.testclient import TestClient
from helpers import sample_payload

from app.auth import AuthService, AuthSettings, SupabaseProvider, fail
from app.main import create_app


class FakeProvider:
    """Test-only identity service; never selected by application configuration."""
    user_id = "1d94120d-7f1d-4e3d-a379-d82438eb7e24"
    refreshed = 0
    unavailable = False
    logout_fails = False

    def login(self, email, password):
        if self.unavailable:
            raise fail(503, "Provider unavailable")
        if email != "client@example.test" or password != "test-only-password":
            raise fail(401, "Email or password is incorrect.")
        return {"access_token": "provider-access-secret", "refresh_token": "provider-refresh-secret", "expires_in": 120}

    def user(self, token):
        return {"id": self.user_id, "email": "client@example.test"}

    def refresh(self, token):
        self.refreshed += 1
        return self.login("client@example.test", "test-only-password")

    def logout(self, token):
        if self.logout_fails:
            raise fail(503, "Provider unavailable")


@pytest.fixture
def system(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    settings = AuthSettings(url="https://example.supabase.co", publishable_key="test-key",
                            frontend_key="f" * 48, encryption_key=Fernet.generate_key().decode(),
                            database=str(tmp_path / "sessions.sqlite3"), idle_seconds=100, max_seconds=300)
    now = [1000.0]
    provider = FakeProvider()
    service = AuthService(settings, provider, lambda: now[0])
    app = create_app()
    app.state.auth_service = service
    client = TestClient(app, headers={"X-Frontend-Key": settings.frontend_key})
    return client, service, provider, now


def sign_in(client):
    response = client.post("/auth/login", json={"email": "client@example.test", "password": "test-only-password"})
    assert response.status_code == 200
    return response.json()


def auth_header(result):
    return {"Authorization": f"Bearer {result['sessionToken']}"}


def test_login_protected_scoring_and_logout(system):
    client, _, _, _ = system
    assert client.post("/assessments", json=sample_payload()).status_code == 401
    result = sign_in(client)
    assert result["user"]["email"] == "client@example.test"
    headers = auth_header(result)
    assert client.get("/auth/session", headers=headers).status_code == 200
    scored = client.post("/assessments", json=sample_payload(), headers=headers)
    assert scored.status_code == 200
    assert scored.json()["mappingVersion"] == "1.1"
    assert client.post("/auth/logout", headers=headers).status_code == 204
    assert client.get("/auth/session", headers=headers).status_code == 401
    assert client.post("/assessments", json=sample_payload(), headers=headers).status_code == 401


def test_unknown_account_and_wrong_password_are_indistinguishable(system):
    client, _, _, _ = system
    responses = [client.post("/auth/login", json={"email": email, "password": "wrong"})
                 for email in ("client@example.test", "unknown@example.test")]
    assert [r.status_code for r in responses] == [401, 401]
    assert responses[0].json() == responses[1].json()


def test_idle_expiry_cannot_be_extended_by_passive_polling(system):
    client, _, _, now = system
    headers = auth_header(sign_in(client))
    now[0] += 80
    assert client.get("/auth/session", headers=headers).status_code == 200
    now[0] += 21
    assert client.post("/auth/activity", headers=headers).status_code == 401


def test_activity_refresh_and_absolute_expiry(system):
    client, _, provider, now = system
    headers = auth_header(sign_in(client))
    for _ in range(3):
        now[0] += 90
        assert client.post("/auth/activity", headers=headers).status_code == 200
    assert provider.refreshed >= 1
    now[0] += 31
    assert client.get("/auth/session", headers=headers).status_code == 401


def test_restarted_server_keeps_session_and_encrypted_provider_credentials(system):
    client, service, provider, now = system
    result = sign_in(client)
    replacement = AuthService(service.settings, provider, lambda: now[0])
    assert replacement.authenticate(result["sessionToken"])["binding"] == result["binding"]
    with sqlite3.connect(service.settings.database) as db:
        row = db.execute("SELECT digest,tokens FROM sessions").fetchone()
    assert row[0] != result["sessionToken"]
    assert b"provider-access-secret" not in row[1]
    assert b"provider-refresh-secret" not in row[1]


def test_logout_still_revokes_locally_during_provider_outage(system):
    client, _, provider, _ = system
    headers = auth_header(sign_in(client))
    provider.logout_fails = True
    assert client.post("/auth/logout", headers=headers).status_code == 204
    assert client.get("/auth/session", headers=headers).status_code == 401


def test_untrusted_frontend_and_forged_tokens_fail(system):
    client, _, _, _ = system
    result = sign_in(client)
    assert client.get("/auth/session", headers={**auth_header(result), "X-Frontend-Key": "wrong"}).status_code == 401
    assert client.get("/auth/session", headers={"Authorization": "Bearer forged"}).status_code == 401


def test_rate_limit_and_no_sensitive_logging(system, caplog):
    client, _, _, _ = system
    for _ in range(5):
        assert client.post("/auth/login", json={"email": "unknown@example.test", "password": "private-password"}).status_code == 401
    assert client.post("/auth/login", json={"email": "unknown@example.test", "password": "private-password"}).status_code == 429
    assert "private-password" not in caplog.text
    assert "unknown@example.test" not in caplog.text


def test_unconfigured_auth_fails_closed_and_health_remains_available(monkeypatch):
    monkeypatch.delenv("SESSION_ENCRYPTION_KEY", raising=False)
    with TestClient(create_app()) as client:
        assert client.get("/health").status_code == 200
        assert client.post("/assessments", json=sample_payload()).status_code == 503


def test_local_store_cannot_be_used_as_production_storage(system, monkeypatch):
    _, service, provider, _ = system
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(HTTPException) as error:
        AuthService(service.settings, provider)
    assert error.value.status_code == 503


def test_sessions_are_isolated(system):
    client, _, _, _ = system
    first, second = sign_in(client), sign_in(client)
    assert first["binding"] != second["binding"]
    client.post("/auth/logout", headers=auth_header(first))
    assert client.get("/auth/session", headers=auth_header(second)).status_code == 200


def test_provider_errors_are_sanitized(system, monkeypatch):
    _, service, _, _ = system
    provider = SupabaseProvider(service.settings)
    monkeypatch.setattr(httpx, "request", lambda *a, **k: httpx.Response(400, json={"message": "Account exists: secret"}))
    with pytest.raises(HTTPException) as error:
        provider.login("client@example.test", "private-password")
    assert error.value.detail == "Email or password is incorrect."


def test_corrupt_token_store_is_rejected(system):
    client, service, _, _ = system
    result = sign_in(client)
    with service.connection() as db:
        db.execute("UPDATE sessions SET tokens=?", (b"invalid",))
    assert client.get("/auth/session", headers=auth_header(result)).status_code == 401
