from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    environment: str = "development"
    version: str = "0.1.0"
    max_request_bytes: int = 16 * 1024
    allowed_origins: tuple[str, ...] = ("http://localhost:3000", "http://127.0.0.1:3000")
    allowed_origin_regex: str | None = None

    @classmethod
    def from_env(cls) -> Settings:
        origins = os.getenv("ALLOWED_ORIGINS")
        return cls(
            environment=os.getenv("APP_ENV", cls.environment),
            version=os.getenv("APP_VERSION", cls.version),
            max_request_bytes=int(os.getenv("MAX_REQUEST_BYTES", cls.max_request_bytes)),
            allowed_origins=cls.allowed_origins
            if origins is None
            else tuple(origin.strip() for origin in origins.split(",") if origin.strip()),
            allowed_origin_regex=os.getenv("ALLOWED_ORIGIN_REGEX") or None,
        )
