from app.scoring import AssessmentRequest


def sample_payload(**overrides):
    payload = {
        "dataTypes": ["emails"],
        "externalAccess": "yes",
        "rawExchange": "no",
        "dataMovement": "no",
        "combined": "no",
        "secondaryUse": "no",
        "purpose": "matching",
    }
    payload.update(overrides)
    return payload


def sample_request(**overrides):
    return AssessmentRequest(**sample_payload(**overrides))
