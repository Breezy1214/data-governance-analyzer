"""Deterministic scoring engine.

`score_assessment` is a pure function: for a given `AssessmentRequest` and
`RuleSet`, it always returns the same score, level, and attributed factors.
The only non-deterministic input (the current time) is injected via
`assessed_at` so callers -- including tests -- can pin it.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.scoring.models import (
    SCHEMA_VERSION,
    AssessmentRequest,
    RiskFactor,
    RiskLevel,
    ScoredAssessment,
)
from app.scoring.recommendations import map_recommendations
from app.scoring.rules import Rule, RuleSet, get_ruleset


def rate(request: AssessmentRequest, ruleset: RuleSet) -> tuple[list[Rule], int, RiskLevel]:
    """The rules an assessment fires, its capped score, and its level."""
    fired = [rule for rule in ruleset.rules if rule.applies(request)]
    score = min(ruleset.score_cap, sum(rule.points for rule in fired))
    return fired, score, ruleset.thresholds.level_for(score)


def score_assessment(
    request: AssessmentRequest,
    ruleset: RuleSet | None = None,
    assessed_at: str | None = None,
) -> ScoredAssessment:
    ruleset = ruleset or get_ruleset()

    fired, score, level = rate(request, ruleset)
    factors = [
        RiskFactor(ruleId=rule.id, category=rule.category, label=rule.label, points=rule.points)
        for rule in fired
    ]
    guidance = ruleset.guidance_by_level[level]

    active_labels = {factor.ruleId: factor.label for factor in factors}
    active_labels.update({signal.id: signal.label for signal in ruleset.signals if signal.applies(request)})
    mapped = map_recommendations(active_labels, ruleset.version)

    limitations = [lim.copy for lim in ruleset.limitations if lim.applies(request)]

    return ScoredAssessment(
        **mapped.model_dump(),
        schemaVersion=SCHEMA_VERSION,
        rulesVersion=ruleset.version,
        score=score,
        level=level,
        guidance=guidance,
        factors=factors,
        maxFactorPoints=max(rule.points for rule in ruleset.rules),
        limitations=limitations,
        assessedAt=assessed_at or datetime.now(timezone.utc).isoformat(),
    )
