import time
import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from helpers import sample_payload
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError

from app.config import Settings
from app.main import create_app

PROJECT = "https://example.supabase.co"


@pytest.fixture
def private_key():
    return ec.generate_private_key(ec.SECP256R1())


def token(private_key, **overrides):
    claims = {
        "sub": str(uuid.uuid4()), "session_id": str(uuid.uuid4()),
        "iss": f"{PROJECT}/auth/v1", "aud": "authenticated",
        "exp": int(time.time()) + 300, "iat": int(time.time()) - 1,
        "role": "authenticated", "is_anonymous": False,
    }
    claims.update(overrides)
    return jwt.encode(claims, private_key, algorithm="ES256", headers={"kid": "test-key"})


@pytest.fixture
def client(private_key):
    app = create_app(Settings(supabase_url=PROJECT, environment="staging"))
    with TestClient(app) as client:
        app.state.token_verifier.keys.get_signing_key_from_jwt = Mock(
            return_value=SimpleNamespace(key=private_key.public_key())
        )
        yield client


def test_staging_accepts_signed_access_token(client, private_key):
    response = client.post("/assessments", json=sample_payload(),
                           headers={"Authorization": f"Bearer {token(private_key)}"})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/health").json()["environment"] == "staging"


@pytest.mark.parametrize("header", ["", "Basic anything", "Bearer ", "Bearer invalid"])
def test_missing_and_malformed_credentials_rejected(client, header):
    response = client.post("/assessments", json=sample_payload(), headers={"Authorization": header})
    assert response.status_code == 401
    assert response.json() == {"message": "Please sign in again."}


@pytest.mark.parametrize("claims", [
    {"exp": 1}, {"iss": "https://attacker.test/auth/v1"}, {"aud": "other"},
    {"sub": "not-a-user"}, {"session_id": "not-a-session"}, {"role": "service_role"},
    {"is_anonymous": True}, {"exp": None}, {"iat": int(time.time()) + 3600},
])
def test_invalid_claims_rejected(client, private_key, claims):
    response = client.post("/assessments", json=sample_payload(),
                           headers={"Authorization": f"Bearer {token(private_key, **claims)}"})
    assert response.status_code == 401


def test_wrong_signature_rejected(client):
    forged = token(ec.generate_private_key(ec.SECP256R1()))
    assert client.post("/assessments", json=sample_payload(),
                       headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_symmetric_tokens_are_not_accepted(client):
    forged = jwt.encode({"sub": "attacker"}, "not-a-real-key" * 4, algorithm="HS256")
    assert client.post("/assessments", json=sample_payload(),
                       headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_jwks_outage_is_service_error_not_logout(client, private_key):
    client.app.state.token_verifier.keys.get_signing_key_from_jwt.side_effect = PyJWKClientConnectionError("private detail")
    response = client.post("/assessments", json=sample_payload(),
                           headers={"Authorization": f"Bearer {token(private_key)}"})
    assert response.status_code == 503
    assert "private detail" not in response.text


def test_unknown_key_is_unauthorized(client, private_key):
    client.app.state.token_verifier.keys.get_signing_key_from_jwt.side_effect = PyJWKClientError("unknown")
    assert client.post("/assessments", json=sample_payload(),
                       headers={"Authorization": f"Bearer {token(private_key)}"}).status_code == 401


@pytest.mark.parametrize("url", ["", "http://example.test", "https://user:secret@example.test", "https://example.test/path"])
def test_invalid_configuration_fails_startup(url):
    with pytest.raises(ValueError, match="SUPABASE_URL"), TestClient(create_app(Settings(supabase_url=url))):
        pass


def test_settings_reads_supabase_configuration(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", PROJECT + "/")
    monkeypatch.setenv("SUPABASE_JWT_AUDIENCE", "authenticated")
    settings = Settings.from_env()
    settings.validate_auth()
    assert settings.supabase_url == PROJECT


def test_backend_does_not_grant_cross_origin_browser_access(client):
    response = client.options("/assessments", headers={
        "Origin": "https://attacker.test", "Access-Control-Request-Method": "POST",
    })
    assert "access-control-allow-origin" not in response.headers
