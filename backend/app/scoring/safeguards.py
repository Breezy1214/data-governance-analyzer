"""What-if simulation: which answer each recommended safeguard changes, and what that does to the score.

A safeguard is a recommendation that, once in place, changes one questionnaire answer. Recommendations
that would change the use case itself (its data, partners, or purpose) or that change no answer have none.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.scoring.engine import rate, score_assessment
from app.scoring.models import (
    AssessmentRequest,
    RiskOutcome,
    SafeguardPlan,
    SimulatedSafeguard,
    Simulation,
)
from app.scoring.recommendations import get_mapping
from app.scoring.rules import HIGH_SENSITIVITY_TYPES, RuleSet, duplicates, get_ruleset

AnswerChange = Callable[[AssessmentRequest], Any | None]


@dataclass(frozen=True)
class Safeguard:
    recommendation_id: str
    field: str
    # The answer once the safeguard is in place, or None when it can't apply to these answers.
    change: AnswerChange


def _answer(value: str) -> AnswerChange:
    return lambda payload: value


def _without_sensitive_types(payload: AssessmentRequest) -> list[str] | None:
    remaining = [item for item in payload.dataTypes if item not in HIGH_SENSITIVITY_TYPES]
    return remaining or None


SAFEGUARDS: tuple[Safeguard, ...] = (
    Safeguard("AVOID_READABLE_IDENTIFIERS", "identifierProtection", _answer("notExchanged")),
    Safeguard("DE_IDENTIFY_SENSITIVE_RECORDS", "dataTypes", _without_sensitive_types),
    Safeguard("LIMIT_CUSTODY_CHANGES", "custodyChange", _answer("no")),
    Safeguard("VERIFY_RULE_ENFORCEMENT", "environmentControl", _answer("own")),
    Safeguard("USE_PARTNER_SPECIFIC_KEYS", "reusableKeys", _answer("no")),
    Safeguard("SET_MINIMUM_MATCH_COUNT", "smallResults", _answer("no")),
    Safeguard("REVIEW_COMBINATION_RISK", "combined", _answer("no")),
    Safeguard("DELETE_AFTER_EXCHANGE", "retainedArtifacts", _answer("no")),
    Safeguard("GATE_SECONDARY_USE", "secondaryUse", _answer("no")),
)


def _validate_safeguards() -> None:
    """Each safeguard belongs to a catalog recommendation and owns a distinct answer, so any set can combine."""
    catalog_ids = {entry.id for entry in get_mapping().recommendations}
    unknown = {item.recommendation_id for item in SAFEGUARDS} - catalog_ids
    if unknown:
        raise ValueError(f"Safeguards for unknown recommendations: {unknown}")
    fields = tuple(item.field for item in SAFEGUARDS)
    if set(fields) - AssessmentRequest.model_fields.keys() or duplicates(fields):
        raise ValueError("Each safeguard must change a different questionnaire answer")


_validate_safeguards()


def with_changes(request: AssessmentRequest, changes: dict[str, Any]) -> AssessmentRequest:
    # Every safeguard sets a valid literal or a subset of the data types, so re-validating would only cost time.
    return request.model_copy(update=changes)


def _subset(items: list[Any], mask: int) -> list[Any]:
    """The items whose bit is set in ``mask``."""
    return [item for bit, item in enumerate(items) if mask >> bit & 1]


def applicable_safeguards(request: AssessmentRequest, ruleset: RuleSet | None = None) -> list[tuple[Safeguard, Any]]:
    """Safeguards whose recommendation this assessment receives and that would change one of its answers."""
    recommended = {item.id for item in score_assessment(request, ruleset).recommendations}
    found = []
    for safeguard in SAFEGUARDS:
        value = safeguard.change(request)
        if safeguard.recommendation_id in recommended and value is not None \
                and value != getattr(request, safeguard.field):
            found.append((safeguard, value))
    return found


def simulate(request: AssessmentRequest, ruleset: RuleSet | None = None) -> Simulation:
    """Score every combination of the applicable safeguards with the real rules.

    ``outcomes[i]`` is the result with every safeguard whose bit is set in ``i`` applied, where bit ``k``
    is ``safeguards[k]``. Safeguards are listed by the points each removes on its own, largest first.
    At most nine safeguards exist, so this is at most 512 cheap rule evaluations.
    """
    ruleset = ruleset or get_ruleset()

    def rated(chosen: list[tuple[Safeguard, Any]]) -> tuple[RiskOutcome, int]:
        fired, score, level = rate(with_changes(request, {item.field: value for item, value in chosen}), ruleset)
        return RiskOutcome(score=score, level=level), sum(rule.points for rule in fired)

    assessed, _ = rated([])
    found = applicable_safeguards(request, ruleset)
    alone = {item.recommendation_id: rated([(item, value)]) for item, value in found}
    # Lowest score first; above the cap a safeguard may remove nothing visible, so uncapped points break ties.
    found.sort(key=lambda pair: (alone[pair[0].recommendation_id][0].score, alone[pair[0].recommendation_id][1]))
    outcomes = [rated(_subset(found, mask))[0] for mask in range(1 << len(found))]

    return Simulation(
        rulesVersion=ruleset.version,
        mappingVersion=get_mapping().version,
        assessed=assessed,
        safeguards=[
            SimulatedSafeguard(recommendationId=item.recommendation_id, field=item.field, answer=value,
                               points=assessed.score - alone[item.recommendation_id][0].score)
            for item, value in found
        ],
        outcomes=outcomes,
        plan=_best_plan([item.recommendation_id for item, _ in found], outcomes),
    )


def _best_plan(ids: list[str], outcomes: list[RiskOutcome]) -> SafeguardPlan:
    """The fewest safeguards that reach LOW; failing that, the fewest that reach the lowest possible score."""
    def size(mask: int) -> int:
        return mask.bit_count()

    masks = range(len(outcomes))
    reaching_low = [mask for mask in masks if outcomes[mask].level == "LOW"]
    if reaching_low:
        best = min(reaching_low, key=lambda mask: (size(mask), outcomes[mask].score))
    else:
        best = min(masks, key=lambda mask: (outcomes[mask].score, size(mask)))
    return SafeguardPlan(applied=_subset(ids, best), **outcomes[best].model_dump())
