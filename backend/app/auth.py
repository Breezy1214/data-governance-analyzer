"""Verify Supabase access tokens before serving assessment data."""
from __future__ import annotations

import uuid

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError

from app.config import Settings


class TokenVerifier:
    def __init__(self, settings: Settings):
        settings.validate_auth()
        self.issuer = f"{settings.supabase_url}/auth/v1"
        self.audience = settings.supabase_audience
        self.keys = PyJWKClient(f"{self.issuer}/.well-known/jwks.json", timeout=8, lifespan=300)

    def verify(self, bearer_token: str) -> dict:
        try:
            header = jwt.get_unverified_header(bearer_token)
            if header.get("alg") not in ("RS256", "ES256"):
                raise jwt.InvalidAlgorithmError()
            signing_key = self.keys.get_signing_key_from_jwt(bearer_token)
            claims = jwt.decode(
                bearer_token, signing_key.key, algorithms=["RS256", "ES256"],
                issuer=self.issuer, audience=self.audience,
                options={"require": ["exp", "iat", "sub", "iss", "aud", "session_id"]},
            )
            uuid.UUID(claims["sub"])
            uuid.UUID(claims["session_id"])
            if claims.get("role") != "authenticated" or claims.get("is_anonymous") is not False:
                raise jwt.InvalidTokenError()
            return claims
        except PyJWKClientConnectionError:
            raise HTTPException(503, "Authentication service is temporarily unavailable.") from None
        except (jwt.InvalidTokenError, PyJWKClientError, ValueError, TypeError, KeyError):
            raise HTTPException(401, "Please sign in again.") from None


def require_session(request: Request) -> dict:
    scheme, _, bearer_token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not bearer_token or len(bearer_token) > 16384:
        raise HTTPException(401, "Please sign in again.")
    verifier = getattr(request.app.state, "token_verifier", None)
    if verifier is None:
        raise HTTPException(503, "Authentication service is temporarily unavailable.")
    return verifier.verify(bearer_token)
