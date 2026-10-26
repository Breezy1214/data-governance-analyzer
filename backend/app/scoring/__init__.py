"""Rule-based privacy risk-scoring service."""

from app.scoring.engine import score_assessment
from app.scoring.models import (
    SCHEMA_VERSION,
    AssessmentRequest,
    AssessmentResponse,
    RecommendationDetail,
    RiskFactor,
)
from app.scoring.rules import CURRENT_RULES_VERSION, get_ruleset

__all__ = [
    "CURRENT_RULES_VERSION",
    "SCHEMA_VERSION",
    "AssessmentRequest",
    "AssessmentResponse",
    "RecommendationDetail",
    "RiskFactor",
    "get_ruleset",
    "score_assessment",
]
