from itertools import product
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.scoring import AssessmentRequest, score_assessment
from app.scoring.recommendations import MappingCatalog, get_mapping, map_recommendations
from app.scoring.rules import get_ruleset


@pytest.mark.parametrize("factor,safeguard", [
    ("DATA_SENSITIVITY_HIGH", "DEIDENTIFY_RECORDS"),
    ("DATA_SENSITIVITY_DIRECT", "FIELD_MINIMIZATION"),
    ("EXTERNAL_ACCESS", "ACCESS_CONTROL"),
    ("RAW_EXCHANGE", "PRIVATE_MATCHING"),
    ("DATA_MOVEMENT", "RETENTION_DELETION"),
    ("COMBINED_REIDENTIFICATION", "REIDENTIFICATION_REVIEW"),
    ("SECONDARY_USE", "SECONDARY_USE_APPROVAL"),
    ("PURPOSE_ANALYTICS", "FIELD_MINIMIZATION"),
    ("PURPOSE_RESEARCH", "PURPOSE_ACCOUNTABILITY"),
    ("PURPOSE_MATCHING", "PRIVATE_MATCHING"),
    ("PURPOSE_OTHER", "PURPOSE_ACCOUNTABILITY"),
    ("PURPOSE_MARKETING", "RETENTION_DELETION"),
    ("PURPOSE_AI", "RETENTION_DELETION"),
])
def test_individual_factor_has_a_relevant_attributed_safeguard(factor, safeguard):
    result = map_recommendations([factor], "1.0")
    assert any(item.id == safeguard and item.factorIds == [factor] for item in result.generalSafeguards)


def test_all_scoring_factors_are_mapped_and_frontend_catalog_matches():
    catalog = get_mapping()
    assert set(catalog.factorSafeguards) == {rule.id for rule in get_ruleset().rules}
    root = Path(__file__).resolve().parents[2]
    backend = root / "backend/app/scoring/mappings/v1.1.json"
    frontend = root / "frontend/lib/mappings/v1.1.json"
    assert backend.read_bytes() == frontend.read_bytes()
    rubric = (root / catalog.source).read_text(encoding="utf-8")
    for entry in catalog.karlsgate:
        assert entry.text in rubric
    assert catalog.approvalStatus == "approved"


def test_approval_release_preserves_historical_pending_catalog():
    factors = ["EXTERNAL_ACCESS", "PURPOSE_MATCHING"]
    historical = map_recommendations(factors, "1.0", "1.0")
    current = map_recommendations(factors, "1.0")
    assert historical.mappingApprovalStatus == "pending"
    assert historical.mappingVersion == "1.0"
    assert current.mappingApprovalStatus == "approved"
    assert current.mappingVersion == "1.1"
    assert current.generalSafeguards == historical.generalSafeguards
    assert current.karlsgateRecommendations == historical.karlsgateRecommendations


def test_applicability_and_coverage_across_all_questionnaire_combinations():
    data_types = ("names", "emails", "phone", "gov", "health", "financial")
    purposes = ("analytics", "research", "matching", "other", "marketing", "ai")
    for data_type, purpose, flags in product(data_types, purposes, product(("yes", "no"), repeat=5)):
        external, raw, movement, combined, secondary = flags
        request = AssessmentRequest(
            dataTypes=[data_type], purpose=purpose, externalAccess=external, rawExchange=raw,
            dataMovement=movement, combined=combined, secondaryUse=secondary,
        )
        result = score_assessment(request)
        capabilities = {item.id for item in result.karlsgateRecommendations}
        assert ("PROTECTED_MATCHING" in capabilities) == (external == "yes" and (raw == "yes" or purpose == "matching"))
        assert ("REID_REMEDIATION" in capabilities) == (combined == "yes")
        assert ("DEIDENTIFICATION" in capabilities) == (data_type in ("gov", "health", "financial"))
        assert {"DATA_MINIMIZATION", "GOVERNANCE_EXECUTION"} <= capabilities
        factors = {item.ruleId for item in result.factors}
        assert {factor for item in result.generalSafeguards for factor in item.factorIds} == factors
        assert all(set(item.factorIds) <= factors for item in result.karlsgateRecommendations)
        assert len({item.id for item in result.generalSafeguards}) == len(result.generalSafeguards)
        actions = [item.action for item in result.recommendationDetails]
        assert {item.text for item in result.generalSafeguards} <= set(actions)
        assert all("Karlsgate" not in text for text in actions)
        assert len(actions) == len(set(actions))
        assert len({item.id for item in result.recommendationDetails}) == len(actions)
        assert [item.priority for item in result.recommendationDetails] == list(range(1, len(actions) + 1))
        assert all(set(item.riskFactorIds) <= factors for item in result.recommendationDetails)


def test_no_specialist_capability_fit_keeps_general_controls():
    result = map_recommendations(["RAW_EXCHANGE", "PURPOSE_ANALYTICS"], "1.0")
    assert "PROTECTED_MATCHING" not in {item.id for item in result.karlsgateRecommendations}
    assert {"ACCESS_CONTROL", "FIELD_MINIMIZATION", "RETENTION_DELETION", "PRIVATE_MATCHING"} <= {
        item.id for item in result.generalSafeguards
    }


def test_versioned_result_is_reproducible_and_retains_combined_reasons():
    factors = ["EXTERNAL_ACCESS", "RAW_EXCHANGE", "PURPOSE_MATCHING", "DATA_SENSITIVITY_HIGH"]
    first = map_recommendations(factors, "1.0", "1.0")
    assert first == map_recommendations(factors, "1.0", "1.0")
    assert first.mappingVersion == "1.0"
    matching = next(item for item in first.karlsgateRecommendations if item.id == "PROTECTED_MATCHING")
    assert matching.conditionId == "EXTERNAL_AND_RAW_OR_MATCHING"
    assert matching.factorIds == factors[:3]


@pytest.mark.parametrize("factors,rules,version", [
    (["UNSUPPORTED"], "1.0", "1.0"),
    (["EXTERNAL_ACCESS"], "99.0", "1.0"),
    (["EXTERNAL_ACCESS"], "1.0", "99.0"),
])
def test_unknown_factors_and_versions_fail_instead_of_inventing_controls(factors, rules, version):
    with pytest.raises(ValueError):
        map_recommendations(factors, rules, version)


@pytest.mark.parametrize("defect", ["missing_factor", "empty_mapping", "unknown_safeguard", "unknown_condition", "duplicate"])
def test_invalid_catalog_is_rejected(defect):
    catalog = get_mapping().model_dump(mode="json")
    if defect == "missing_factor":
        del catalog["factorSafeguards"]["RAW_EXCHANGE"]
    elif defect == "empty_mapping":
        catalog["factorSafeguards"]["RAW_EXCHANGE"] = []
    elif defect == "unknown_safeguard":
        catalog["factorSafeguards"]["RAW_EXCHANGE"] = ["UNKNOWN"]
    elif defect == "unknown_condition":
        catalog["karlsgate"][0]["anyOfAllFactors"] = [["UNKNOWN"]]
    else:
        catalog["safeguards"].append(catalog["safeguards"][0])
    with pytest.raises(ValidationError):
        MappingCatalog.model_validate(catalog)
