"""Local SCRUM-22 sessions. Only the Next.js server receives bearer credentials."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field


def fail(status: int, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail=message, headers={"Cache-Control": "no-store"})


@dataclass(frozen=True)
class AuthSettings:
    url: str = ""
    publishable_key: str = ""
    frontend_key: str = ""
    encryption_key: str = ""
    database: str = ".local/auth.sqlite3"
    idle_seconds: int = 1800
    max_seconds: int = 28800

    @classmethod
    def from_env(cls):
        return cls(
            url=os.getenv("SUPABASE_URL", "").rstrip("/"),
            publishable_key=os.getenv("SUPABASE_PUBLISHABLE_KEY", ""),
            frontend_key=os.getenv("FRONTEND_SHARED_KEY", ""),
            encryption_key=os.getenv("SESSION_ENCRYPTION_KEY", ""),
            database=os.getenv("AUTH_DATABASE_PATH", cls.database),
            idle_seconds=int(os.getenv("AUTH_IDLE_SECONDS", cls.idle_seconds)),
            max_seconds=int(os.getenv("AUTH_MAX_SECONDS", cls.max_seconds)),
        )


class SupabaseProvider:
    def __init__(self, settings: AuthSettings):
        self.settings = settings

    def call(self, method: str, path: str, *, token: str = "", body=None):
        headers = {"apikey": self.settings.publishable_key}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            response = httpx.request(method, f"{self.settings.url}/auth/v1/{path}",
                                     headers=headers, json=body, timeout=8, follow_redirects=False)
        except httpx.HTTPError:
            raise fail(503, "Sign-in service is temporarily unavailable.") from None
        if response.status_code == 429:
            raise fail(429, "Too many attempts. Please try again later.")
        if response.status_code in (400, 401, 403, 422):
            raise fail(401, "Email or password is incorrect.")
        if not response.is_success:
            raise fail(503, "Sign-in service is temporarily unavailable.")
        try:
            return response.json() if response.content else {}
        except ValueError:
            raise fail(503, "Sign-in service is temporarily unavailable.") from None

    def login(self, email: str, password: str):
        return self.call("POST", "token?grant_type=password", body={"email": email, "password": password})

    def refresh(self, refresh_token: str):
        return self.call("POST", "token?grant_type=refresh_token", body={"refresh_token": refresh_token})

    def user(self, access_token: str):
        return self.call("GET", "user", token=access_token)

    def logout(self, access_token: str):
        self.call("POST", "logout?scope=local", token=access_token)


class AuthService:
    def __init__(self, settings: AuthSettings, provider=None, clock=time.time):
        self.settings = settings
        self.provider = provider or SupabaseProvider(settings)
        self.clock = clock
        try:
            self.cipher = Fernet(settings.encryption_key.encode())
        except (ValueError, TypeError):
            raise fail(503, "Sign-in is not configured yet.") from None
        if not settings.url.startswith("https://") or not settings.publishable_key or len(settings.frontend_key) < 32:
            raise fail(503, "Sign-in is not configured yet.")
        if settings.idle_seconds <= 0 or settings.max_seconds < settings.idle_seconds:
            raise fail(503, "Sign-in is not configured yet.")
        # This local-only SQLite adapter must not silently become production storage.
        if os.getenv("APP_ENV", "development") not in ("development", "test"):
            raise fail(503, "Hosted authentication storage has not been configured.")
        Path(settings.database).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    digest TEXT PRIMARY KEY, binding TEXT NOT NULL, uid TEXT NOT NULL,
                    email TEXT NOT NULL, tokens BLOB NOT NULL, token_expiry REAL NOT NULL,
                    expires REAL NOT NULL, last_seen REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS attempts (
                    bucket TEXT PRIMARY KEY, started REAL NOT NULL, count INTEGER NOT NULL);
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.settings.database, timeout=12)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA secure_delete=ON")
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        finally:
            db.close()

    @staticmethod
    def digest(token: str):
        return hashlib.sha256(token.encode()).hexdigest()

    def cleanup(self):
        now = self.clock()
        with self.connection() as db:
            db.execute("DELETE FROM sessions WHERE expires <= ? OR last_seen <= ?",
                       (now, now - self.settings.idle_seconds))
            db.execute("DELETE FROM attempts WHERE started <= ?", (now - 900,))

    def public(self, row):
        return {"user": {"id": row["uid"], "email": row["email"]}, "binding": row["binding"],
                "expiresAt": row["expires"], "idleExpiresAt": row["last_seen"] + self.settings.idle_seconds}

    def limit(self, email: str):
        now = self.clock()
        bucket = hmac.new(self.settings.encryption_key.encode(), email.encode(), hashlib.sha256).hexdigest()
        with self.connection() as db:
            db.execute("DELETE FROM attempts WHERE started <= ?", (now - 900,))
            db.execute("DELETE FROM sessions WHERE expires <= ? OR last_seen <= ?",
                       (now, now - self.settings.idle_seconds))
            for key, maximum in ((bucket, 5), ("global", 100)):
                row = db.execute("SELECT count FROM attempts WHERE bucket = ?", (key,)).fetchone()
                if row and row["count"] >= maximum:
                    raise fail(429, "Too many attempts. Please try again later.")
            for key in (bucket, "global"):
                db.execute("INSERT INTO attempts VALUES (?, ?, 1) ON CONFLICT(bucket) DO UPDATE SET count=count+1",
                           (key, now))

    def validate_tokens(self, tokens):
        try:
            if not isinstance(tokens["access_token"], str) or not isinstance(tokens["refresh_token"], str):
                raise TypeError
            duration = float(tokens["expires_in"])
            if not 0 < duration <= 86400:
                raise ValueError
            user = self.provider.user(tokens["access_token"])
            uuid.UUID(user["id"])
            if not isinstance(user["email"], str):
                raise TypeError
            encrypted = self.cipher.encrypt(json.dumps({"access_token": tokens["access_token"],
                                                       "refresh_token": tokens["refresh_token"]}).encode())
            return user, encrypted, self.clock() + duration
        except (KeyError, ValueError, TypeError):
            raise fail(503, "Sign-in service is temporarily unavailable.") from None

    def login(self, email: str, password: str):
        self.limit(email)
        tokens = self.provider.login(email, password)
        user, encrypted, expiry = self.validate_tokens(tokens)
        token, now = secrets.token_urlsafe(48), self.clock()
        row = {"digest": self.digest(token), "binding": str(uuid.uuid4()), "uid": user["id"], "email": user["email"],
               "tokens": encrypted, "token_expiry": expiry, "expires": now + self.settings.max_seconds, "last_seen": now}
        with self.connection() as db:
            db.execute("INSERT INTO sessions VALUES (:digest,:binding,:uid,:email,:tokens,:token_expiry,:expires,:last_seen)", row)
        return {**self.public(row), "sessionToken": token}

    def authenticate(self, token: str, touch: bool = False):
        if not token or len(token) > 128:
            raise fail(401, "Please sign in again.")
        now = self.clock()
        with self.connection() as db:
            row = db.execute("SELECT * FROM sessions WHERE digest = ?", (self.digest(token),)).fetchone()
            if not row or row["expires"] <= now or row["last_seen"] + self.settings.idle_seconds <= now:
                raise fail(401, "Please sign in again.")
            row = dict(row)
            try:
                tokens = json.loads(self.cipher.decrypt(row["tokens"]))
                if row["token_expiry"] <= now + 60:
                    user, encrypted, expiry = self.validate_tokens(self.provider.refresh(tokens["refresh_token"]))
                    if user["id"] != row["uid"]:
                        raise fail(401, "Please sign in again.")
                    row.update(tokens=encrypted, token_expiry=expiry)
                if touch:
                    row["last_seen"] = now
                db.execute("UPDATE sessions SET tokens=:tokens, token_expiry=:token_expiry, last_seen=:last_seen WHERE digest=:digest", row)
            except (InvalidToken, ValueError, KeyError):
                raise fail(401, "Please sign in again.") from None
        return self.public(row)

    def logout(self, token: str):
        with self.connection() as db:
            row = db.execute("SELECT tokens FROM sessions WHERE digest = ?", (self.digest(token),)).fetchone()
            db.execute("DELETE FROM sessions WHERE digest = ?", (self.digest(token),))
        # Local revocation is committed first and remains effective during provider outages.
        if row:
            try:
                tokens = json.loads(self.cipher.decrypt(row["tokens"]))
                self.provider.logout(tokens["access_token"])
            except (HTTPException, InvalidToken, ValueError, KeyError):
                pass


def service(request: Request) -> AuthService:
    configured = getattr(request.app.state, "auth_service", None)
    if configured is None:
        configured = AuthService(AuthSettings.from_env())
        request.app.state.auth_service = configured
    configured.cleanup()
    return configured


def frontend(request: Request):
    auth = service(request)
    supplied = request.headers.get("x-frontend-key", "")
    if not hmac.compare_digest(supplied.encode(), auth.settings.frontend_key.encode()):
        raise fail(401, "Please sign in again.")
    return auth


def bearer(request: Request):
    header = request.headers.get("authorization", "")
    return header[7:] if header.startswith("Bearer ") else ""


def require_session(request: Request):
    return frontend(request).authenticate(bearer(request), touch=True)


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=1024)


router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post("/login")
def login(payload: LoginInput, request: Request, response: Response, auth: Annotated[AuthService, Depends(frontend)]):
    response.headers["Cache-Control"] = "no-store"
    result = auth.login(payload.email.strip().lower(), payload.password)
    if bearer(request):
        auth.logout(bearer(request))
    return result


@router.get("/session")
def session(request: Request, response: Response, auth: Annotated[AuthService, Depends(frontend)]):
    response.headers["Cache-Control"] = "no-store"
    return auth.authenticate(bearer(request))


@router.post("/activity")
def activity(request: Request, response: Response, auth: Annotated[AuthService, Depends(frontend)]):
    response.headers["Cache-Control"] = "no-store"
    return auth.authenticate(bearer(request), touch=True)


@router.post("/logout", status_code=204)
def logout(request: Request, auth: Annotated[AuthService, Depends(frontend)]):
    auth.logout(bearer(request))
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
