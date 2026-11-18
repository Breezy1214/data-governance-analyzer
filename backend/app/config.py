from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit

LOCAL_ENVIRONMENTS = frozenset({"development", "local", "test"})


@dataclass(frozen=True)
class Settings:
    # Fails closed: a deploy that forgets APP_ENV hides the API docs. .env.example sets development locally.
    environment: str = "production"
    version: str = "0.1.0"
    max_request_bytes: int = 16 * 1024
    supabase_url: str = ""
    supabase_audience: str = "authenticated"
    demo_rate_per_client: int = 30
    demo_rate_total: int = 600
    # Signed-in scoring (save, re-assess, what-if) per user and overall, per minute.
    scoring_rate_per_user: int = 30
    scoring_rate_total: int = 600
    # The register_api role's connection string; without it, signed-in results are scored but not saved.
    database_url: str = ""
    # Shared with the Next.js server. X-Demo-Client is only trusted on requests that carry it.
    demo_proxy_secret: str = ""

    @property
    def docs_enabled(self) -> bool:
        """The interactive API docs and OpenAPI schema are only served on a developer's machine."""
        return self.environment in LOCAL_ENVIRONMENTS

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
            demo_rate_per_client=int(os.getenv("DEMO_RATE_PER_CLIENT", cls.demo_rate_per_client)),
            demo_rate_total=int(os.getenv("DEMO_RATE_TOTAL", cls.demo_rate_total)),
            scoring_rate_per_user=int(os.getenv("SCORING_RATE_PER_USER", cls.scoring_rate_per_user)),
            scoring_rate_total=int(os.getenv("SCORING_RATE_TOTAL", cls.scoring_rate_total)),
            database_url=os.getenv("DATABASE_URL", ""),
            demo_proxy_secret=os.getenv("DEMO_PROXY_SECRET", ""),
        )
