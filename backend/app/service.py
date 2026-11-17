from __future__ import annotations

import uuid

from fastapi import Response

from app.logging_config import logger
from app.scoring import AssessmentRequest, AssessmentResponse, score_assessment
from app.scoring.models import Simulation
from app.scoring.safeguards import simulate


def score_and_log(payload: AssessmentRequest, response: Response, *, demo: bool, api_version: str) -> AssessmentResponse:
    # Results describe a sensitive use case; keep them out of browser and proxy caches.
    response.headers["Cache-Control"] = "no-store"
    result = AssessmentResponse(**score_assessment(payload).model_dump(), apiVersion=api_version)
    logger.info(
        "assessment_scored",
        extra={
            "fields": {
                "requestId": str(uuid.uuid4()),
                "demo": demo,
                "schemaVersion": result.schemaVersion,
                "rulesVersion": result.rulesVersion,
                "apiVersion": result.apiVersion,
                "mappingVersion": result.mappingVersion,
                "score": result.score,
                "riskLevel": result.level,
                "ruleIds": [factor.ruleId for factor in result.factors],
            }
        },
    )
    return result


def simulate_and_log(payload: AssessmentRequest, response: Response, *, demo: bool) -> Simulation:
    # Simulations derive from the same sensitive answers, so they stay out of caches too.
    response.headers["Cache-Control"] = "no-store"
    result = simulate(payload)
    logger.info(
        "assessment_simulated",
        extra={
            "fields": {
                "requestId": str(uuid.uuid4()),
                "demo": demo,
                "rulesVersion": result.rulesVersion,
                "score": result.assessed.score,
                "safeguards": [item.recommendationId for item in result.safeguards],
            }
        },
    )
    return result
