import json
from pathlib import Path

from app.config import Settings
from app.scoring import AssessmentRequest

DEMO_SCENARIOS = json.loads(
    (Path(__file__).resolve().parents[2] / "frontend" / "lib" / "demo-scenarios.json").read_text()
)
UNLIMITED_DEMO = Settings(supabase_url="https://example.supabase.co", demo_rate_per_client=1000, demo_rate_total=1000)


def scoring_payload(scenario):
    """A sample scenario's answers without the description, which never reaches the API."""
    return {key: value for key, value in scenario["input"].items() if key != "description"}


def sample_payload(**overrides):
    """A partner overlap check with the lowest-risk answers for everything else (score 28)."""
    payload = {
        "dataTypes": ["emails"],
        "purpose": "overlap",
        "participants": "onePartner",
        "identifierProtection": "notExchanged",
        "custodyChange": "no",
        "environmentControl": "own",
        "reusableKeys": "no",
        "smallResults": "no",
        "combined": "no",
        "retainedArtifacts": "no",
        "secondaryUse": "no",
        "regulations": ["none"],
        "identifierConsistency": "yes",
    }
    payload.update(overrides)
    return payload


def sample_request(**overrides):
    return AssessmentRequest(**sample_payload(**overrides))
