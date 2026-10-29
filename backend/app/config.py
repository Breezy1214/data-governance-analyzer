from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    environment: str = "development"
    version: str = "0.1.0"
    max_request_bytes: int = 16 * 1024
    supabase_url: str = ""
    supabase_audience: str = "authenticated"

    def validate_auth(self) -> None:
        parsed = urlsplit(self.supabase_url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path):
            raise ValueError("SUPABASE_URL must be an HTTPS project origin.")
        if not self.supabase_audience:
            raise ValueError("SUPABASE_JWT_AUDIENCE must not be empty.")

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            environment=os.getenv("APP_ENV", cls.environment),
            version=os.getenv("APP_VERSION", cls.version),
            max_request_bytes=int(os.getenv("MAX_REQUEST_BYTES", cls.max_request_bytes)),
            supabase_url=os.getenv("SUPABASE_URL", "").rstrip("/"),
            supabase_audience=os.getenv("SUPABASE_JWT_AUDIENCE", cls.supabase_audience),
        )
