import pytest
from helpers import sample_request
from pydantic import ValidationError

from app.scoring import score_assessment
from app.scoring.rules import RULESET_V2_0, RiskThresholds

ASSESSED_AT = "2026-01-01T00:00:00+00:00"


def factor_ids(result):
    return {factor.ruleId for factor in result.factors}


@pytest.mark.parametrize(
    "score,expected_level",
    [(0, "LOW"), (29, "LOW"), (30, "MEDIUM"), (59, "MEDIUM"), (60, "HIGH"), (100, "HIGH")],
)
def test_threshold_boundaries(score, expected_level):
    assert RiskThresholds(low_max=29, medium_max=59).level_for(score) == expected_level


def test_low_risk_internal_analytics_with_only_email_addresses():
    result = score_assessment(sample_request(participants="internal", purpose="analytics"), assessed_at=ASSESSED_AT)
    assert result.score == 14  # direct identifiers (12) + analytics (2)
    assert result.level == "LOW"
    assert factor_ids(result) == {"DATA_SENSITIVITY_DIRECT", "PURPOSE_ANALYTICS"}


def test_medium_risk_partner_matching_with_hashed_identifiers():
    result = score_assessment(sample_request(identifierProtection="hashedTokenized"), assessed_at=ASSESSED_AT)
    assert result.score == 40  # direct (12) + one partner (12) + hashed (12) + overlap (4)
    assert result.level == "MEDIUM"


def test_high_risk_regulated_data_caps_at_100():
    result = score_assessment(
        sample_request(
            dataTypes=["health", "financial"],
            participants="multiplePartners",
            identifierProtection="cleartext",
            custodyChange="yes",
            environmentControl="thirdParty",
            reusableKeys="yes",
            smallResults="yes",
            combined="yes",
            retainedArtifacts="yes",
            secondaryUse="yes",
            purpose="ai",
        ),
        assessed_at=ASSESSED_AT,
    )
    assert result.score == 100
    assert result.level == "HIGH"
    assert len(result.limitations) == 2


def test_high_risk_boundary_exactly_at_threshold():
    boundary = score_assessment(
        sample_request(dataTypes=["gov"], identifierProtection="cleartext", purpose="other"),
        assessed_at=ASSESSED_AT,
    )
    assert boundary.score == 60  # gov (24) + one partner (12) + cleartext (18) + other (6)
    assert boundary.level == "HIGH"


def test_data_sensitivity_rules_are_mutually_exclusive():
    result = score_assessment(sample_request(dataTypes=["names", "health"]), assessed_at=ASSESSED_AT)
    assert "DATA_SENSITIVITY_HIGH" in factor_ids(result)
    assert "DATA_SENSITIVITY_DIRECT" not in factor_ids(result)


@pytest.mark.parametrize("data_type", ["postal", "device", "adId"])
def test_new_identifier_types_score_as_direct_identifiers(data_type):
    result = score_assessment(sample_request(dataTypes=[data_type]), assessed_at=ASSESSED_AT)
    assert "DATA_SENSITIVITY_DIRECT" in factor_ids(result)


def test_every_factor_carries_a_stable_rule_id_and_points_sum_to_score():
    result = score_assessment(sample_request(), assessed_at=ASSESSED_AT)
    assert all(factor.ruleId for factor in result.factors)
    assert sum(factor.points for factor in result.factors) == result.score


FACTOR_CASES = [
    ("DATA_SENSITIVITY_HIGH", {"dataTypes": ["health"]}),
    ("DATA_SENSITIVITY_DIRECT", {"dataTypes": ["emails"]}),
    ("PARTICIPANTS_ONE", {"participants": "onePartner"}),
    ("PARTICIPANTS_MULTIPLE", {"participants": "multiplePartners"}),
    ("IDENTIFIERS_CLEARTEXT", {"identifierProtection": "cleartext"}),
    ("IDENTIFIERS_UNKNOWN", {"identifierProtection": "notSure"}),
    ("IDENTIFIERS_HASHED", {"identifierProtection": "hashedTokenized"}),
    ("IDENTIFIERS_DECRYPTED", {"identifierProtection": "encryptedDecrypted"}),
    ("IDENTIFIERS_CLEAN_ROOM", {"identifierProtection": "cleanRoom"}),
    ("CUSTODY_CHANGE", {"custodyChange": "yes"}),
    ("ENVIRONMENT_NOT_OWNED", {"environmentControl": "partner"}),
    ("REUSABLE_KEYS", {"reusableKeys": "yes"}),
    ("SMALL_RESULTS", {"smallResults": "yes"}),
    ("COMBINED_REIDENTIFICATION", {"combined": "yes"}),
    ("RETAINED_ARTIFACTS", {"retainedArtifacts": "yes"}),
    ("SECONDARY_USE", {"secondaryUse": "yes"}),
    ("PURPOSE_ANALYTICS", {"purpose": "analytics"}),
    ("PURPOSE_OVERLAP", {"purpose": "overlap"}),
    ("PURPOSE_FRAUD", {"purpose": "fraud"}),
    ("PURPOSE_ENRICHMENT", {"purpose": "enrichment"}),
    ("PURPOSE_HEALTH_RESEARCH", {"purpose": "healthResearch"}),
    ("PURPOSE_OTHER", {"purpose": "other"}),
    ("PURPOSE_ADVERTISING", {"purpose": "advertising"}),
    ("PURPOSE_AI", {"purpose": "ai"}),
]


def test_factor_cases_cover_the_whole_ruleset():
    assert {rule_id for rule_id, _ in FACTOR_CASES} == {rule.id for rule in RULESET_V2_0.rules}


@pytest.mark.parametrize("expected_rule_id,overrides", FACTOR_CASES)
def test_every_supported_factor_is_exercised_and_selects_a_recommendation(expected_rule_id, overrides):
    result = score_assessment(sample_request(**overrides), assessed_at=ASSESSED_AT)
    factor = next(item for item in result.factors if item.ruleId == expected_rule_id)
    assert any(factor.label in item.basedOn for item in result.recommendations)


@pytest.mark.parametrize("field,risky", [
    ("custodyChange", "yes"),
    ("reusableKeys", "yes"),
    ("smallResults", "yes"),
    ("retainedArtifacts", "yes"),
    ("environmentControl", "partner"),
    ("identifierProtection", "cleartext"),
])
def test_not_sure_scores_the_same_as_the_riskier_answer(field, risky):
    unsure = score_assessment(sample_request(**{field: "notSure"}), assessed_at=ASSESSED_AT)
    answered = score_assessment(sample_request(**{field: risky}), assessed_at=ASSESSED_AT)
    assert unsure.score == answered.score > score_assessment(sample_request(), assessed_at=ASSESSED_AT).score


def test_unscored_answers_do_not_change_the_score():
    base = score_assessment(sample_request(), assessed_at=ASSESSED_AT)
    other = score_assessment(
        sample_request(identifierConsistency="no", regulations=["gdpr", "ccpa"]),
        assessed_at=ASSESSED_AT,
    )
    assert other.score == base.score
    assert {item.id for item in other.recommendations} - {item.id for item in base.recommendations} == {
        "STANDARDIZE_IDENTIFIERS"
    }
    assert len(other.limitations) == 2


@pytest.mark.parametrize("overrides,expected", [
    ({"dataTypes": ["health"]}, "HIPAA"),
    ({"regulations": ["hipaa"]}, "HIPAA"),
    ({"dataTypes": ["financial"]}, "PCI DSS"),
    ({"regulations": ["gdpr"]}, "GDPR"),
    ({"regulations": ["ccpa"]}, "CCPA"),
    ({"regulations": ["notSure"]}, "not yet confirmed"),
])
def test_limitations_follow_data_types_and_selected_rules(overrides, expected):
    result = score_assessment(sample_request(**overrides), assessed_at=ASSESSED_AT)
    assert any(expected in item for item in result.limitations)


def test_identical_input_produces_identical_output_for_same_rules_version():
    request = sample_request()
    first = score_assessment(request, assessed_at=ASSESSED_AT)
    second = score_assessment(request, assessed_at=ASSESSED_AT)
    assert first == second


def test_rejects_empty_data_types():
    with pytest.raises(ValidationError):
        sample_request(dataTypes=[])


def test_rejects_duplicate_data_types():
    with pytest.raises(ValidationError):
        sample_request(dataTypes=["emails", "emails"])


def test_rejects_unknown_purpose():
    with pytest.raises(ValidationError):
        sample_request(purpose="not-a-real-purpose")


@pytest.mark.parametrize("regulations", [[], ["gdpr", "gdpr"], ["none", "gdpr"], ["notSure", "hipaa"], ["none", "notSure"]])
def test_rejects_inconsistent_regulations(regulations):
    with pytest.raises(ValidationError):
        sample_request(regulations=regulations)


@pytest.mark.parametrize("field", ["externalAccess", "rawExchange", "dataMovement"])
def test_rejects_retired_questions(field):
    with pytest.raises(ValidationError):
        sample_request(**{field: "yes"})
