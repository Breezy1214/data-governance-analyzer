"""Central, versioned scoring configuration.

Every weight, threshold, and applicability rule here is derived from the
rubric in ``docs/risk-scoring-rubric-v2.0.md``. To add or change a rule (e.g.
for a new rubric version), define a new ``RuleSet`` below and register it in
``RULESETS`` -- the engine never needs to change.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Callable

from app.scoring.models import AssessmentRequest, RiskLevel

HIGH_SENSITIVITY_TYPES = frozenset({"gov", "health", "financial"})
DIRECT_IDENTIFIER_TYPES = frozenset({"names", "emails", "phone", "postal", "device", "adId"})

Predicate = Callable[[AssessmentRequest], bool]


@dataclass(frozen=True)
class Rule:
    id: str
    category: str
    label: str
    points: int
    applies: Predicate


@dataclass(frozen=True)
class Signal:
    """An unscored answer that selects a recommendation without changing the risk score."""

    id: str
    label: str
    applies: Predicate


@dataclass(frozen=True)
class Limitation:
    """A caveat surfaced when a regulated data category or named regulation is involved."""

    id: str
    copy: str
    applies: Predicate


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
    signals: tuple[Signal, ...]
    limitations: tuple[Limitation, ...]


def _has_high_sensitivity(payload: AssessmentRequest) -> bool:
    return any(item in HIGH_SENSITIVITY_TYPES for item in payload.dataTypes)


def _has_direct_identifiers_only(payload: AssessmentRequest) -> bool:
    return not _has_high_sensitivity(payload) and any(
        item in DIRECT_IDENTIFIER_TYPES for item in payload.dataTypes
    )


def _protection_is(value: str) -> Predicate:
    return lambda payload: payload.identifierProtection == value


def _purpose_is(value: str) -> Predicate:
    return lambda payload: payload.purpose == value


RULESET_V2_0 = RuleSet(
    version="2.0",
    score_cap=100,
    thresholds=RiskThresholds(low_max=29, medium_max=59),
    guidance_by_level={
        "LOW": "Standard safeguards and an accountable owner are likely sufficient.",
        "MEDIUM": "Proceed only after the listed controls and an accountable review are in place.",
        "HIGH": "Pause implementation until privacy, security, and governance controls are approved.",
    },
    # Tuple order is the factor display order. "Not sure" scores like the riskier answer.
    rules=(
        Rule("DATA_SENSITIVITY_HIGH", "data_sensitivity", "Regulated or highly sensitive information", 24, _has_high_sensitivity),
        Rule("DATA_SENSITIVITY_DIRECT", "data_sensitivity", "Direct personal identifiers", 12, _has_direct_identifiers_only),
        Rule("PARTICIPANTS_ONE", "access", "One outside organization takes part", 12, lambda p: p.participants == "onePartner"),
        Rule("PARTICIPANTS_MULTIPLE", "access", "Several outside organizations take part", 16, lambda p: p.participants == "multiplePartners"),
        Rule("IDENTIFIERS_CLEARTEXT", "identifiers", "Identifiers exchanged in readable form", 18, _protection_is("cleartext")),
        Rule("IDENTIFIERS_UNKNOWN", "identifiers", "Identifier protection not yet known", 18, _protection_is("notSure")),
        Rule("IDENTIFIERS_HASHED", "identifiers", "Identifiers exchanged as hashes or tokens", 12, _protection_is("hashedTokenized")),
        Rule("IDENTIFIERS_DECRYPTED", "identifiers", "Identifiers encrypted, then decrypted by the recipient", 12, _protection_is("encryptedDecrypted")),
        Rule("IDENTIFIERS_CLEAN_ROOM", "identifiers", "Identifiers sent into a clean room", 6, _protection_is("cleanRoom")),
        Rule("CUSTODY_CHANGE", "custody", "Data may end up in another party's custody", 10, lambda p: p.custodyChange != "no"),
        Rule("ENVIRONMENT_NOT_OWNED", "custody", "Your organization may not control the environment or enforce the rules", 6, lambda p: p.environmentControl != "own"),
        Rule("REUSABLE_KEYS", "reidentification", "Match keys may be reused across partners or over time", 8, lambda p: p.reusableKeys != "no"),
        Rule("SMALL_RESULTS", "reidentification", "Results may be small enough to single someone out", 6, lambda p: p.smallResults != "no"),
        Rule("COMBINED_REIDENTIFICATION", "reidentification", "Re-identification potential from data combination", 8, lambda p: p.combined == "yes"),
        Rule("RETAINED_ARTIFACTS", "lifecycle", "Keys, hashes, tokens, or copies may be kept afterward", 8, lambda p: p.retainedArtifacts != "no"),
        Rule("SECONDARY_USE", "purpose", "Reuse beyond the stated purpose", 8, lambda p: p.secondaryUse == "yes"),
        Rule("PURPOSE_ANALYTICS", "purpose", "Intended use: Internal analytics", 2, _purpose_is("analytics")),
        Rule("PURPOSE_OVERLAP", "purpose", "Intended use: Overlap analysis", 4, _purpose_is("overlap")),
        Rule("PURPOSE_FRAUD", "purpose", "Intended use: Fraud or anti-money-laundering checks", 4, _purpose_is("fraud")),
        Rule("PURPOSE_ENRICHMENT", "purpose", "Intended use: Data enrichment", 6, _purpose_is("enrichment")),
        Rule("PURPOSE_HEALTH_RESEARCH", "purpose", "Intended use: Patient or clinical research", 6, _purpose_is("healthResearch")),
        Rule("PURPOSE_OTHER", "purpose", "Intended use: Other", 6, _purpose_is("other")),
        Rule("PURPOSE_ADVERTISING", "purpose", "Intended use: Advertising audience or measurement", 8, _purpose_is("advertising")),
        Rule("PURPOSE_AI", "purpose", "Intended use: AI model training", 8, _purpose_is("ai")),
    ),
    signals=(
        Signal("IDENTIFIERS_INCONSISTENT", "Identifier formats may differ across sources", lambda p: p.identifierConsistency != "yes"),
    ),
    limitations=(
        Limitation(
            "HIPAA_REVIEW",
            "HIPAA applicability and required agreements need specialist review; this tool does not determine compliance.",
            lambda p: "health" in p.dataTypes or "hipaa" in p.regulations,
        ),
        Limitation(
            "PCI_REVIEW",
            "PCI DSS scope depends on the exact account data involved; this tool does not determine compliance.",
            lambda p: "financial" in p.dataTypes,
        ),
        Limitation(
            "GDPR_REVIEW",
            "GDPR or UK GDPR applicability, lawful basis, and cross-border transfers need specialist review; this tool does not determine compliance.",
            lambda p: "gdpr" in p.regulations,
        ),
        Limitation(
            "CCPA_REVIEW",
            "CCPA/CPRA obligations, including sale and sharing opt-outs, need specialist review; this tool does not determine compliance.",
            lambda p: "ccpa" in p.regulations,
        ),
        Limitation(
            "REGULATIONS_UNKNOWN",
            "The rules that apply to this use case are not yet confirmed; ask your privacy or legal team before proceeding.",
            lambda p: "notSure" in p.regulations,
        ),
    ),
)


def duplicates(values: tuple[str, ...]) -> set[str]:
    return {value for value, count in Counter(values).items() if count > 1}


def _validate_ruleset(ruleset: RuleSet) -> None:
    """Fail fast when a versioned ruleset is internally inconsistent."""

    if not 0 <= ruleset.thresholds.low_max < ruleset.thresholds.medium_max < ruleset.score_cap:
        raise ValueError(f"Invalid thresholds for ruleset {ruleset.version}")

    duplicate_ids = duplicates(tuple(item.id for item in (*ruleset.rules, *ruleset.signals)))
    if duplicate_ids:
        raise ValueError(f"Duplicate identifiers in ruleset {ruleset.version}: {duplicate_ids}")

    expected_levels = {"LOW", "MEDIUM", "HIGH"}
    if set(ruleset.guidance_by_level) != expected_levels:
        raise ValueError(f"Incomplete guidance in ruleset {ruleset.version}")


_validate_ruleset(RULESET_V2_0)

RULESETS: Mapping[str, RuleSet] = {RULESET_V2_0.version: RULESET_V2_0}
CURRENT_RULES_VERSION = RULESET_V2_0.version


def get_ruleset(version: str | None = None) -> RuleSet:
    """Look up a ruleset by version, defaulting to the current one."""
    resolved = version or CURRENT_RULES_VERSION
    try:
        return RULESETS[resolved]
    except KeyError as exc:
        raise ValueError(f"Unsupported rules version: {resolved!r}") from exc
