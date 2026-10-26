"""Central, versioned scoring configuration.

Every weight, threshold, and applicability rule here is derived from the
approved rubric in ``docs/risk-scoring-rubric-v1.0.md``. To add or change a
rule (e.g. for a new rubric version), define a new ``RuleSet`` below and
register it in ``RULESETS`` -- the engine never needs to change.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Callable

from app.scoring.models import AssessmentRequest, RiskLevel

HIGH_SENSITIVITY_TYPES = frozenset({"gov", "health", "financial"})
DIRECT_IDENTIFIER_TYPES = frozenset({"names", "emails", "phone"})

Predicate = Callable[[AssessmentRequest], bool]


@dataclass(frozen=True)
class Rule:
    id: str
    category: str
    label: str
    points: int
    applies: Predicate


@dataclass(frozen=True)
class Limitation:
    """A caveat surfaced when a regulated data category is involved."""

    id: str
    copy: str
    applies: Predicate


@dataclass(frozen=True)
class RecommendationRule:
    id: str
    title: str
    action: str
    rationale: str
    applies: Predicate
    risk_factor_ids: tuple[str, ...]


@dataclass(frozen=True)
class RiskThresholds:
    low_max: int
    medium_max: int

    def level_for(self, score: int) -> RiskLevel:
        if score <= self.low_max:
            return "LOW"
        if score <= self.medium_max:
            return "MEDIUM"
        return "HIGH"


@dataclass(frozen=True)
class RuleSet:
    version: str
    score_cap: int
    thresholds: RiskThresholds
    guidance_by_level: Mapping[RiskLevel, str]
    rules: tuple[Rule, ...]
    limitations: tuple[Limitation, ...]
    recommendations: tuple[RecommendationRule, ...]


def _has_high_sensitivity(payload: AssessmentRequest) -> bool:
    return any(item in HIGH_SENSITIVITY_TYPES for item in payload.dataTypes)


def _has_direct_identifiers_only(payload: AssessmentRequest) -> bool:
    return not _has_high_sensitivity(payload) and any(
        item in DIRECT_IDENTIFIER_TYPES for item in payload.dataTypes
    )


def _uses_protected_matching(payload: AssessmentRequest) -> bool:
    return payload.externalAccess == "yes" and (payload.rawExchange == "yes" or payload.purpose == "matching")


PURPOSE_RULE_IDS = (
    "PURPOSE_ANALYTICS",
    "PURPOSE_RESEARCH",
    "PURPOSE_MATCHING",
    "PURPOSE_OTHER",
    "PURPOSE_MARKETING",
    "PURPOSE_AI",
)


RULESET_V1_0 = RuleSet(
    version="1.0",
    score_cap=100,
    thresholds=RiskThresholds(low_max=29, medium_max=59),
    guidance_by_level={
        "LOW": "Standard safeguards and an accountable owner are likely sufficient.",
        "MEDIUM": "Proceed only after the listed controls and an accountable review are in place.",
        "HIGH": "Pause implementation until privacy, security, and governance controls are approved.",
    },
    # Tuple order is the factor display order.
    rules=(
        Rule("DATA_SENSITIVITY_HIGH", "data_sensitivity", "Regulated or highly sensitive information", 28, _has_high_sensitivity),
        Rule("DATA_SENSITIVITY_DIRECT", "data_sensitivity", "Direct personal identifiers", 14, _has_direct_identifiers_only),
        Rule("EXTERNAL_ACCESS", "access", "Access by another organization", 18, lambda p: p.externalAccess == "yes"),
        Rule("RAW_EXCHANGE", "access", "Raw identifier exchange", 18, lambda p: p.rawExchange == "yes"),
        Rule("DATA_MOVEMENT", "movement", "Data leaves its controlled environment", 12, lambda p: p.dataMovement == "yes"),
        Rule("COMBINED_REIDENTIFICATION", "reidentification", "Re-identification potential from data combination", 12, lambda p: p.combined == "yes"),
        Rule("SECONDARY_USE", "purpose", "Reuse beyond the stated purpose", 12, lambda p: p.secondaryUse == "yes"),
        Rule("PURPOSE_ANALYTICS", "purpose", "Intended use: Internal analytics", 2, lambda p: p.purpose == "analytics"),
        Rule("PURPOSE_RESEARCH", "purpose", "Intended use: Research", 4, lambda p: p.purpose == "research"),
        Rule("PURPOSE_MATCHING", "purpose", "Intended use: Customer or record matching", 6, lambda p: p.purpose == "matching"),
        Rule("PURPOSE_OTHER", "purpose", "Intended use: Other", 6, lambda p: p.purpose == "other"),
        Rule("PURPOSE_MARKETING", "purpose", "Intended use: Marketing or advertising", 8, lambda p: p.purpose == "marketing"),
        Rule("PURPOSE_AI", "purpose", "Intended use: AI model training or development", 10, lambda p: p.purpose == "ai"),
    ),
    limitations=(
        Limitation(
            "HIPAA_REVIEW",
            "HIPAA applicability and required agreements need specialist review; this MVP does not determine compliance.",
            lambda p: "health" in p.dataTypes,
        ),
        Limitation(
            "PCI_REVIEW",
            "PCI DSS scope depends on the exact account data involved; this MVP does not determine compliance.",
            lambda p: "financial" in p.dataTypes,
        ),
    ),
    # Tuple order is the user-visible priority order. Each rule names the
    # scoring factors that explain why it appears; the engine returns only
    # factor ids that actually fired for the assessment.
    recommendations=(
        RecommendationRule(
            "PROTECTED_MATCHING",
            "Protect cross-party matching",
            "Use protected matching instead of transferring raw identifiers.",
            "Another organization will participate in matching or receive identifiable data, so identifiers should remain protected across that boundary.",
            _uses_protected_matching,
            ("EXTERNAL_ACCESS", "RAW_EXCHANGE", "PURPOSE_MATCHING"),
        ),
        RecommendationRule(
            "REIDENTIFICATION_REVIEW",
            "Reduce combination risk",
            "Measure and remediate re-identification risk before combining datasets.",
            "Linking datasets can reveal a person or sensitive attribute even when each source appears limited on its own.",
            lambda p: p.combined == "yes",
            ("COMBINED_REIDENTIFICATION",),
        ),
        RecommendationRule(
            "DEIDENTIFY_SENSITIVE_DATA",
            "De-identify sensitive records",
            "De-identify sensitive records before they leave the originating system.",
            "Regulated or high-impact information increases potential harm if directly identifying values remain exposed.",
            _has_high_sensitivity,
            ("DATA_SENSITIVITY_HIGH", "DATA_MOVEMENT"),
        ),
        RecommendationRule(
            "SECONDARY_USE_GATE",
            "Gate any secondary use",
            "Create a separate approval gate for any secondary use.",
            "Reuse beyond the stated purpose can exceed the original notice, consent, contract, or policy basis.",
            lambda p: p.secondaryUse == "yes",
            ("SECONDARY_USE",),
        ),
        RecommendationRule(
            "ROLE_BASED_ACCESS",
            "Restrict and review access",
            "Limit access to named roles and review permissions regularly.",
            "Named ownership and periodic review reduce unnecessary exposure throughout the approved use.",
            lambda p: True,
            ("EXTERNAL_ACCESS", "RAW_EXCHANGE", "DATA_MOVEMENT", *PURPOSE_RULE_IDS),
        ),
        RecommendationRule(
            "FIELD_MINIMIZATION",
            "Minimize the data",
            "Collect and share only the fields required for the approved purpose.",
            "Using fewer fields reduces the impact of every identified data-sensitivity and purpose risk.",
            lambda p: True,
            ("DATA_SENSITIVITY_HIGH", "DATA_SENSITIVITY_DIRECT", *PURPOSE_RULE_IDS),
        ),
        RecommendationRule(
            "RETENTION_AND_RESPONSE",
            "Set lifecycle responsibilities",
            "Set retention, deletion, and incident-response responsibilities before launch.",
            "A defined lifecycle limits how long risk persists and makes ownership clear if an incident occurs.",
            lambda p: True,
            ("DATA_MOVEMENT", "SECONDARY_USE", *PURPOSE_RULE_IDS),
        ),
        RecommendationRule(
            "GOVERNANCE_RECORD",
            "Record the decision",
            "Record the approved purpose, data owner, and control evidence in the governance register.",
            "A reviewable record connects the approved use and its safeguards to the risks identified in this assessment.",
            lambda p: True,
            (
                "DATA_SENSITIVITY_HIGH",
                "DATA_SENSITIVITY_DIRECT",
                "EXTERNAL_ACCESS",
                "RAW_EXCHANGE",
                "DATA_MOVEMENT",
                "COMBINED_REIDENTIFICATION",
                "SECONDARY_USE",
                *PURPOSE_RULE_IDS,
            ),
        ),
    ),
)


def _duplicates(values: tuple[str, ...]) -> set[str]:
    return {value for value, count in Counter(values).items() if count > 1}


def _validate_ruleset(ruleset: RuleSet) -> None:
    """Fail fast when a versioned ruleset is internally inconsistent."""

    if not 0 <= ruleset.thresholds.low_max < ruleset.thresholds.medium_max < ruleset.score_cap:
        raise ValueError(f"Invalid thresholds for ruleset {ruleset.version}")

    rule_ids = tuple(rule.id for rule in ruleset.rules)
    recommendation_ids = tuple(rule.id for rule in ruleset.recommendations)
    duplicate_ids = {
        "rules": _duplicates(rule_ids),
        "recommendations": _duplicates(recommendation_ids),
    }
    collisions = {kind: values for kind, values in duplicate_ids.items() if values}
    if collisions:
        raise ValueError(f"Duplicate identifiers in ruleset {ruleset.version}: {collisions}")

    duplicate_references = {
        recommendation.id: duplicates
        for recommendation in ruleset.recommendations
        if (duplicates := _duplicates(recommendation.risk_factor_ids))
    }
    if duplicate_references:
        raise ValueError(
            f"Duplicate safeguard factor mappings in ruleset {ruleset.version}: {duplicate_references}"
        )

    known_rule_ids = set(rule_ids)
    mapped_rule_ids = {
        rule_id
        for recommendation in ruleset.recommendations
        for rule_id in recommendation.risk_factor_ids
    }
    unknown_rule_ids = mapped_rule_ids - known_rule_ids
    unmapped_rule_ids = known_rule_ids - mapped_rule_ids
    if unknown_rule_ids or unmapped_rule_ids:
        raise ValueError(
            f"Invalid safeguard mapping in ruleset {ruleset.version}: "
            f"unknown={sorted(unknown_rule_ids)}, unmapped={sorted(unmapped_rule_ids)}"
        )

    expected_levels = {"LOW", "MEDIUM", "HIGH"}
    if set(ruleset.guidance_by_level) != expected_levels:
        raise ValueError(f"Incomplete guidance in ruleset {ruleset.version}")


_validate_ruleset(RULESET_V1_0)

RULESETS: Mapping[str, RuleSet] = {RULESET_V1_0.version: RULESET_V1_0}
CURRENT_RULES_VERSION = RULESET_V1_0.version


def get_ruleset(version: str | None = None) -> RuleSet:
    """Look up a ruleset by version, defaulting to the current one."""
    resolved = version or CURRENT_RULES_VERSION
    try:
        return RULESETS[resolved]
    except KeyError as exc:
        raise ValueError(f"Unsupported rules version: {resolved!r}") from exc
