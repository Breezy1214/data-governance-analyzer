"""Explicitly launched, isolated browser-test server; not an application login mode."""
import os
from dataclasses import replace
from tempfile import TemporaryDirectory

import uvicorn
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from test_auth import FakeProvider

from app.auth import AuthService, AuthSettings
from app.main import create_app

if __name__ == "__main__":
    if os.environ.get("SCRUM22_BROWSER_TEST") != "1":
        raise RuntimeError("This test fixture must be explicitly enabled by the test runner.")
    load_dotenv(".env")
    os.environ["APP_ENV"] = "test"
    with TemporaryDirectory(prefix="scrum22-browser-") as folder:
        settings = replace(AuthSettings.from_env(), url="https://example.supabase.co", publishable_key="test-key",
                           encryption_key=Fernet.generate_key().decode(), database=f"{folder}/session.sqlite3")
        app = create_app()
        app.state.auth_service = AuthService(settings, FakeProvider())
        uvicorn.run(app, host="127.0.0.1", port=8012)
