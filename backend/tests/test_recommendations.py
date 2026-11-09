import re
from itertools import product
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from helpers import sample_request
from pydantic import ValidationError

from app.scoring import score_assessment
from app.scoring.recommendations import MappingCatalog, get_mapping, map_recommendations

BASELINE = {"RESTRICT_ACCESS", "MINIMIZE_FIELDS", "SET_LIFECYCLE_RESPONSIBILITIES", "RECORD_THE_DECISION"}
FIRST_PERSON = re.compile(r"\b(we|our|ours|us|we're|we'll)\b", re.IGNORECASE)


def recommendation_ids(**overrides):
    return {item.id for item in score_assessment(sample_request(**overrides)).recommendations}


@pytest.mark.parametrize("overrides,expected", [
    ({"identifierProtection": "cleartext"}, "AVOID_READABLE_IDENTIFIERS"),
    ({"identifierProtection": "encryptedDecrypted"}, "AVOID_READABLE_IDENTIFIERS"),
    ({"identifierProtection": "notSure"}, "AVOID_READABLE_IDENTIFIERS"),
    ({"identifierProtection": "hashedTokenized"}, "TREAT_HASHES_AS_PERSONAL_DATA"),
    ({"identifierProtection": "cleanRoom"}, "CONFIRM_CLEAN_ROOM_TERMS"),
    ({"dataTypes": ["gov"]}, "DE_IDENTIFY_SENSITIVE_RECORDS"),
    ({"custodyChange": "yes"}, "LIMIT_CUSTODY_CHANGES"),
    ({"environmentControl": "thirdParty"}, "VERIFY_RULE_ENFORCEMENT"),
    ({"reusableKeys": "yes"}, "USE_PARTNER_SPECIFIC_KEYS"),
    ({"smallResults": "yes"}, "SET_MINIMUM_MATCH_COUNT"),
    ({"combined": "yes"}, "REVIEW_COMBINATION_RISK"),
    ({"retainedArtifacts": "yes"}, "DELETE_AFTER_EXCHANGE"),
    ({"secondaryUse": "yes"}, "GATE_SECONDARY_USE"),
    ({"purpose": "enrichment"}, "SHARE_ONLY_THE_MATCH_RESULT"),
    ({"purpose": "healthResearch"}, "CONFIRM_RESEARCH_BASIS"),
    ({"purpose": "fraud"}, "LIMIT_FRAUD_CHECK_SCOPE"),
    ({"purpose": "advertising"}, "CHECK_ADVERTISING_OPT_OUTS"),
    ({"purpose": "ai"}, "DOCUMENT_AI_TRAINING_DATA"),
    ({"identifierConsistency": "no"}, "STANDARDIZE_IDENTIFIERS"),
    ({"identifierConsistency": "notSure"}, "STANDARDIZE_IDENTIFIERS"),
    ({"participants": "multiplePartners"}, "PLAN_REPEATABLE_ONBOARDING"),
])
def test_each_answer_selects_its_recommendation_and_the_lowest_risk_answer_does_not(overrides, expected):
    assert expected in recommendation_ids(**overrides)
    assert expected not in recommendation_ids(purpose="analytics")


def test_different_identifier_answers_produce_different_guidance():
    answers = ("cleartext", "hashedTokenized", "cleanRoom", "notExchanged")
    results = [recommendation_ids(identifierProtection=answer) for answer in answers]
    assert len({frozenset(result) for result in results}) == len(answers)


def test_readable_identifier_advice_does_not_require_matching_for_internal_analytics():
    result = score_assessment(sample_request(
        purpose="analytics", participants="internal", identifierProtection="encryptedDecrypted",
    ))
    item = next(entry for entry in result.recommendations if entry.id == "AVOID_READABLE_IDENTIFIERS")
    assert item.action.startswith("Remove or de-identify identifiers if the purpose does not need them.")
    assert "If records must be linked" in item.action


def test_lowest_risk_answers_keep_only_baseline_and_purpose_guidance():
    assert recommendation_ids() == BASELINE | {"SHARE_ONLY_THE_MATCH_RESULT"}
    assert recommendation_ids(purpose="analytics", participants="internal") == BASELINE


def test_selected_recommendation_cites_the_answer_that_triggered_it():
    result = score_assessment(sample_request(identifierProtection="hashedTokenized"))
    item = next(entry for entry in result.recommendations if entry.id == "TREAT_HASHES_AS_PERSONAL_DATA")
    assert item.basedOn == ["Identifiers exchanged as hashes or tokens"]
    assert {entry.publisher for entry in item.references} == {
        "GDPR Recital 26", "U.S. Department of Health and Human Services",
    }
    assert all(entry.sourceUrl.startswith("https://") for entry in item.references)


def test_baseline_recommendation_without_a_matching_answer_has_no_basis_labels():
    result = score_assessment(sample_request())
    item = next(entry for entry in result.recommendations if entry.id == "SET_LIFECYCLE_RESPONSIBILITIES")
    assert item.basedOn == []


def test_coverage_and_ordering_across_representative_combinations():
    data_types = ("emails", "gov", "health")
    purposes = ("overlap", "enrichment", "healthResearch", "fraud", "advertising", "ai", "analytics", "other")
    protections = ("notExchanged", "cleartext", "hashedTokenized", "encryptedDecrypted", "cleanRoom", "notSure")
    flags = ("yes", "no", "notSure")
    catalog_ids = [entry.id for entry in get_mapping().recommendations]
    for data_type, purpose, protection, flag in product(data_types, purposes, protections, flags):
        result = score_assessment(sample_request(
            dataTypes=[data_type], purpose=purpose, identifierProtection=protection,
            custodyChange=flag, reusableKeys=flag, smallResults=flag, retainedArtifacts=flag,
            identifierConsistency=flag,
        ))
        ids = [item.id for item in result.recommendations]
        assert BASELINE <= set(ids)
        assert len(ids) == len(set(ids))
        assert ids == [entry for entry in catalog_ids if entry in ids]
        assert [item.priority for item in result.recommendations] == list(range(1, len(ids) + 1))
        factor_labels = {factor.label for factor in result.factors}
        assert all(factor_labels & set(item.basedOn) or item.id in BASELINE or item.id == "STANDARDIZE_IDENTIFIERS"
                   for item in result.recommendations)


def test_catalog_is_approved_and_documented():
    catalog = get_mapping()
    assert catalog.approvalStatus == "approved"
    assert (Path(__file__).resolve().parents[2] / catalog.source).exists()


def test_catalog_is_not_written_in_the_first_person():
    for entry in get_mapping().recommendations:
        for text in (entry.title, entry.action, entry.rationale):
            assert not FIRST_PERSON.search(text), text


def test_every_source_is_https_on_its_publishers_domain_and_used():
    catalog = get_mapping()
    expected_hosts = {
        "GDPR Recital 26": "gdpr-info.eu",
        "U.S. Department of Health and Human Services": "www.hhs.gov",
        "California Attorney General": "oag.ca.gov",
    }
    used = {citation.sourceId for entry in catalog.recommendations for citation in entry.references}
    assert used == set(catalog.sources)
    for source in catalog.sources.values():
        parts = urlsplit(source.url)
        assert parts.scheme == "https"
        assert parts.hostname == expected_hosts[source.publisher]


@pytest.mark.parametrize("rules,version", [("99.0", "2.0"), ("2.0", "99.0")])
def test_unknown_versions_fail_instead_of_inventing_recommendations(rules, version):
    with pytest.raises(ValueError):
        map_recommendations({"CUSTODY_CHANGE": "label"}, rules, version)


@pytest.mark.parametrize("defect", [
    "unknown_trigger", "uncovered_rule", "unselectable", "unknown_source", "duplicate", "insecure_source",
])
def test_invalid_catalog_is_rejected(defect):
    catalog = get_mapping().model_dump(mode="json")
    entry = next(item for item in catalog["recommendations"] if item["references"])
    if defect == "unknown_trigger":
        entry["triggers"] = ["UNKNOWN", *entry["triggers"]]
    elif defect == "uncovered_rule":
        catalog["recommendations"] = [item for item in catalog["recommendations"] if item["id"] != "GATE_SECONDARY_USE"]
    elif defect == "unselectable":
        entry["baseline"] = False
        entry["triggers"] = []
    elif defect == "unknown_source":
        entry["references"][0]["sourceId"] = "UNKNOWN"
    elif defect == "insecure_source":
        catalog["sources"]["CA_AG_CCPA"]["url"] = "http://oag.ca.gov/privacy/ccpa"
    else:
        catalog["recommendations"].append(entry)
    with pytest.raises(ValidationError):
        MappingCatalog.model_validate(catalog)
