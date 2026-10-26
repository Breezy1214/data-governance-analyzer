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
    AssessmentResponse,
    RecommendationDetail,
    RiskFactor,
)
from app.scoring.recommendations import map_recommendations
from app.scoring.rules import RuleSet, get_ruleset


def score_assessment(
    request: AssessmentRequest,
    ruleset: RuleSet | None = None,
    assessed_at: str | None = None,
) -> AssessmentResponse:
    ruleset = ruleset or get_ruleset()

    factors = [
        RiskFactor(ruleId=rule.id, category=rule.category, label=rule.label, points=rule.points)
        for rule in ruleset.rules
        if rule.applies(request)
    ]

    raw_score = sum(factor.points for factor in factors)
    score = min(ruleset.score_cap, raw_score)
    level = ruleset.thresholds.level_for(score)
    guidance = ruleset.guidance_by_level[level]

    mapped = map_recommendations([factor.ruleId for factor in factors], ruleset.version)

    fired_rule_ids = {factor.ruleId for factor in factors}
    recommendation_rules = [rule for rule in ruleset.recommendations if rule.applies(request)]
    recommendation_details = [
        RecommendationDetail(
            id=rule.id,
            priority=priority,
            title=rule.title,
            action=rule.action,
            rationale=rule.rationale,
            riskFactorIds=[rule_id for rule_id in rule.risk_factor_ids if rule_id in fired_rule_ids],
        )
        for priority, rule in enumerate(recommendation_rules, start=1)
    ]

    # Preserve v2 priorities/rationales, then include any catalog safeguard not
    # already represented (e.g. internal raw exchange without vendor matching).
    actions = {item.action for item in recommendation_details}
    for safeguard in mapped.generalSafeguards:
        if safeguard.text not in actions and safeguard.factorIds:
            recommendation_details.append(RecommendationDetail(
                id=safeguard.id,
                priority=len(recommendation_details) + 1,
                title="Additional safeguard",
                action=safeguard.text,
                rationale="This safeguard addresses the identified risk factors listed below.",
                riskFactorIds=safeguard.factorIds,
            ))
            actions.add(safeguard.text)

    limitations = [lim.copy for lim in ruleset.limitations if lim.applies(request)]

    return AssessmentResponse(
        **mapped.model_dump(),
        schemaVersion=SCHEMA_VERSION,
        rulesVersion=ruleset.version,
        score=score,
        level=level,
        guidance=guidance,
        factors=factors,
        recommendationDetails=recommendation_details,
        capabilities=[item.label for item in mapped.karlsgateRecommendations],
        limitations=limitations,
        assessedAt=assessed_at or datetime.now(timezone.utc).isoformat(),
    )
