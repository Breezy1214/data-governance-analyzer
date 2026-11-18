import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from helpers import DEMO_SCENARIOS, UNLIMITED_DEMO, sample_payload, sample_request, scoring_payload

from app.auth import require_session
from app.config import Settings
from app.main import create_app
from app.scoring import AssessmentRequest, get_ruleset, score_assessment
from app.scoring.engine import rate
from app.scoring.recommendations import get_mapping
from app.scoring.safeguards import SAFEGUARDS, applicable_safeguards, simulate, with_changes

SCENARIOS = {item["id"]: scoring_payload(item) for item in DEMO_SCENARIOS}


def fired(request):
    return {rule.id for rule in rate(request, get_ruleset())[0]}


def apply(request, recommendation_id):
    found = {item.recommendation_id: (item, value) for item, value in applicable_safeguards(request)}
    item, value = found[recommendation_id]
    return with_changes(request, {item.field: value})


def test_only_recommendations_that_change_an_answer_get_a_safeguard():
    assert {item.recommendation_id for item in SAFEGUARDS} == {
        "AVOID_READABLE_IDENTIFIERS", "DE_IDENTIFY_SENSITIVE_RECORDS", "LIMIT_CUSTODY_CHANGES",
        "VERIFY_RULE_ENFORCEMENT", "USE_PARTNER_SPECIFIC_KEYS", "SET_MINIMUM_MATCH_COUNT",
        "REVIEW_COMBINATION_RISK", "DELETE_AFTER_EXCHANGE", "GATE_SECONDARY_USE",
    }
    assert {item.recommendation_id for item in SAFEGUARDS} <= {entry.id for entry in get_mapping().recommendations}


@pytest.mark.parametrize(("recommendation_id", "answers", "removed", "added"), [
    ("AVOID_READABLE_IDENTIFIERS", {"identifierProtection": "cleartext"}, {"IDENTIFIERS_CLEARTEXT"}, set()),
    ("AVOID_READABLE_IDENTIFIERS", {"identifierProtection": "notSure"}, {"IDENTIFIERS_UNKNOWN"}, set()),
    ("AVOID_READABLE_IDENTIFIERS", {"identifierProtection": "encryptedDecrypted"}, {"IDENTIFIERS_DECRYPTED"}, set()),
    ("DE_IDENTIFY_SENSITIVE_RECORDS", {"dataTypes": ["health", "gov", "emails"]},
     {"DATA_SENSITIVITY_HIGH"}, {"DATA_SENSITIVITY_DIRECT"}),
    ("LIMIT_CUSTODY_CHANGES", {"custodyChange": "notSure"}, {"CUSTODY_CHANGE"}, set()),
    ("VERIFY_RULE_ENFORCEMENT", {"environmentControl": "thirdParty"}, {"ENVIRONMENT_NOT_OWNED"}, set()),
    ("USE_PARTNER_SPECIFIC_KEYS", {"reusableKeys": "yes"}, {"REUSABLE_KEYS"}, set()),
    ("SET_MINIMUM_MATCH_COUNT", {"smallResults": "yes"}, {"SMALL_RESULTS"}, set()),
    ("REVIEW_COMBINATION_RISK", {"combined": "yes"}, {"COMBINED_REIDENTIFICATION"}, set()),
    ("DELETE_AFTER_EXCHANGE", {"retainedArtifacts": "notSure"}, {"RETAINED_ARTIFACTS"}, set()),
    ("GATE_SECONDARY_USE", {"secondaryUse": "yes"}, {"SECONDARY_USE"}, set()),
])
def test_each_safeguard_changes_exactly_the_answer_it_represents(recommendation_id, answers, removed, added):
    before = sample_request(**answers)
    after = apply(before, recommendation_id)
    changed = {key for key, value in after.model_dump().items() if value != before.model_dump()[key]}
    assert len(changed) == 1
    assert fired(before) - fired(after) == removed
    assert fired(after) - fired(before) == added


def test_safeguards_apply_only_when_their_recommendation_is_given():
    assert applicable_safeguards(sample_request()) == []
    # The clean-room and hashing advice changes no answer, so it is recommended without a toggle.
    for protection in ("cleanRoom", "hashedTokenized"):
        assert applicable_safeguards(sample_request(identifierProtection=protection)) == []


def test_de_identifying_needs_other_data_to_remain():
    assert applicable_safeguards(sample_request(dataTypes=["health"])) == []


def test_every_outcome_is_the_real_score_of_those_answers():
    request = AssessmentRequest(**SCENARIOS["clinic-ai-vendor"])
    simulation = simulate(request)
    found = {item.recommendation_id: (item, value) for item, value in applicable_safeguards(request)}
    assert simulation.assessed.score == score_assessment(request).score
    assert len(simulation.outcomes) == 2 ** len(simulation.safeguards)
    for mask, outcome in enumerate(simulation.outcomes):
        chosen = [found[item.recommendationId] for bit, item in enumerate(simulation.safeguards) if mask >> bit & 1]
        changed = with_changes(request, {item.field: value for item, value in chosen})
        expected = score_assessment(changed)
        assert (outcome.score, outcome.level) == (expected.score, expected.level)
    for bit, item in enumerate(simulation.safeguards):
        assert item.points == simulation.assessed.score - simulation.outcomes[1 << bit].score


def test_safeguards_are_ordered_by_impact():
    points = [item.points for item in simulate(AssessmentRequest(**SCENARIOS["clinic-ai-vendor"])).safeguards]
    assert points == [18, 12, 10, 8, 6]


def test_uncapped_points_order_safeguards_when_the_score_is_capped():
    request = sample_request(dataTypes=["health", "emails"], purpose="ai", participants="multiplePartners",
                             identifierProtection="cleartext", custodyChange="yes", environmentControl="partner",
                             reusableKeys="yes", smallResults="yes", combined="yes", retainedArtifacts="yes",
                             secondaryUse="yes")
    simulation = simulate(request)
    assert simulation.assessed.score == 100
    assert {item.points for item in simulation.safeguards} == {0}
    assert simulation.safeguards[0].recommendationId == "AVOID_READABLE_IDENTIFIERS"
    assert simulation.safeguards[-1].recommendationId == "SET_MINIMUM_MATCH_COUNT"
    assert len(simulation.outcomes) == 512


def test_plan_uses_the_fewest_safeguards_that_reach_low():
    plan = simulate(sample_request(participants="internal", custodyChange="yes", smallResults="yes")).plan
    assert (plan.applied, plan.score, plan.level) == (["LIMIT_CUSTODY_CHANGES"], 22, "LOW")


@pytest.mark.parametrize(("scenario", "applied", "score", "level"), [
    ("clinic-ai-vendor", 5, 32, "MEDIUM"),
    ("retail-card-partner", 3, 34, "MEDIUM"),
    ("internal-sales-dashboard", 0, 14, "LOW"),
])
def test_plan_reaches_the_lowest_score_when_low_is_out_of_reach(scenario, applied, score, level):
    plan = simulate(AssessmentRequest(**SCENARIOS[scenario])).plan
    assert (len(plan.applied), plan.score, plan.level) == (applied, score, level)


class UntouchableStore:
    def __getattr__(self, name):
        raise AssertionError(f"a simulation used the register ({name})")


@pytest.fixture
def client():
    app = create_app(UNLIMITED_DEMO)
    test_client = TestClient(app)
    app.state.register_store = UntouchableStore()
    return test_client


def test_signed_in_simulation_needs_a_session(client):
    assert client.post("/simulations", json=sample_payload()).status_code == 401


def test_simulations_never_touch_the_register(client):
    client.app.dependency_overrides[require_session] = lambda: {"sub": "simulation-test"}
    signed_in = client.post("/simulations", json=sample_payload(custodyChange="yes"))
    demo = client.post("/demo/simulations", json=sample_payload(custodyChange="yes"))
    assert signed_in.status_code == demo.status_code == 200
    assert signed_in.json() == demo.json()
    assert signed_in.headers["cache-control"] == "no-store"
    assert signed_in.json()["safeguards"] == [
        {"recommendationId": "LIMIT_CUSTODY_CHANGES", "field": "custodyChange", "answer": "no", "points": 10}]


def test_demo_simulations_share_the_demo_quota():
    limited = TestClient(create_app(Settings(supabase_url="https://example.supabase.co",
                                             demo_rate_per_client=2, demo_rate_total=10,
                                             demo_proxy_secret="proxy-secret")))
    headers = {"X-Demo-Client": "203.0.113.9", "X-Demo-Proxy-Secret": "proxy-secret"}
    assert limited.post("/demo/assessments", json=sample_payload(), headers=headers).status_code == 200
    assert limited.post("/demo/simulations", json=sample_payload(), headers=headers).status_code == 200
    assert limited.post("/demo/simulations", json=sample_payload(), headers=headers).status_code == 429


def test_simulations_reject_invalid_answers(client):
    response = client.post("/demo/simulations", json=sample_payload(custodyChange="maybe"))
    assert response.status_code == 422
    assert response.json()["fields"] == ["custodyChange"]


def test_frontend_fixture_matches_the_backend():
    """The frontend tests use a recorded simulation; this keeps it equal to what the rules produce."""
    fixture = json.loads(
        (Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures" / "clinic-simulation.json").read_text()
    )
    request = AssessmentRequest(**SCENARIOS[fixture["scenario"]])
    assert fixture["simulation"] == simulate(request).model_dump(mode="json")
    scored = score_assessment(request).model_dump(mode="json")
    for key in ("score", "level", "factors", "recommendations", "rulesVersion", "mappingVersion"):
        assert fixture["result"][key] == scored[key]
