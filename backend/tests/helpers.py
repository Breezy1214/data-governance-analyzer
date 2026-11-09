from app.scoring import AssessmentRequest


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
