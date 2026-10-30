"""Verify Supabase access tokens before serving assessment data."""
from __future__ import annotations

import uuid

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError

from app.config import Settings

ALGORITHMS = ["RS256", "ES256"]
SIGN_IN_AGAIN = "Please sign in again."
AUTH_UNAVAILABLE = "Authentication service is temporarily unavailable."
MAX_TOKEN_LENGTH = 16 * 1024


class TokenVerifier:
    def __init__(self, settings: Settings):
        settings.validate_auth()
        self.issuer = f"{settings.supabase_url}/auth/v1"
        self.audience = settings.supabase_audience
        self.keys = PyJWKClient(f"{self.issuer}/.well-known/jwks.json", timeout=8, lifespan=300)

    def verify(self, bearer_token: str) -> dict:
        try:
            signing_key = self.keys.get_signing_key_from_jwt(bearer_token)
            claims = jwt.decode(
                bearer_token, signing_key.key, algorithms=ALGORITHMS,
                issuer=self.issuer, audience=self.audience,
                options={"require": ["exp", "iat", "sub", "session_id"]},
            )
            uuid.UUID(claims["sub"])
            uuid.UUID(claims["session_id"])
            if claims.get("role") != "authenticated" or claims.get("is_anonymous") is not False:
                raise jwt.InvalidTokenError()
            return claims
        except PyJWKClientConnectionError:
            raise HTTPException(503, AUTH_UNAVAILABLE) from None
        except (jwt.InvalidTokenError, PyJWKClientError, ValueError, TypeError, AttributeError):
            raise HTTPException(401, SIGN_IN_AGAIN) from None


def require_session(request: Request) -> dict:
    scheme, _, bearer_token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not bearer_token or len(bearer_token) > MAX_TOKEN_LENGTH:
        raise HTTPException(401, SIGN_IN_AGAIN)
    return request.app.state.token_verifier.verify(bearer_token)
