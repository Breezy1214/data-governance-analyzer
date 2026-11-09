# Recommendation catalog v2.0

Status: **approved**
Catalog: `backend/app/scoring/mappings/v2.0.json`
Rubric: [v2.0](risk-scoring-rubric-v2.0.md)
Supersedes: mapping v1.1

## Authoring rules

These are enforced by `backend/tests/test_recommendations.py`:

1. Nothing is written in the first person.
2. References shown to users are regulatory only, use HTTPS, and sit on the publisher's own domain, except GDPR Recital 26, which uses a reprint.

## Sources

Checked on November 4, 2026. Recheck each source before a release that relies on it, and update `sourcesCheckedOn`.

| ID | Publisher | Source |
| --- | --- | --- |
| `GDPR_RECITAL_26` | GDPR | [Recital 26](https://gdpr-info.eu/recitals/no-26/) |
| `HHS_DEIDENTIFICATION` | U.S. HHS | [De-identification guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html) |
| `CA_AG_CCPA` | California Attorney General | [California Consumer Privacy Act](https://oag.ca.gov/privacy/ccpa) |

## Answer-to-recommendation mapping

| Recommendation | Selected by |
| --- | --- |
| `AVOID_READABLE_IDENTIFIERS` | Readable, decrypted, or unknown identifier protection |
| `TREAT_HASHES_AS_PERSONAL_DATA` | Hashed or tokenized identifiers |
| `CONFIRM_CLEAN_ROOM_TERMS` | Clean room |
| `DE_IDENTIFY_SENSITIVE_RECORDS` | High-sensitivity data |
| `LIMIT_CUSTODY_CHANGES` | Custody change |
| `VERIFY_RULE_ENFORCEMENT` | Environment not controlled by the organization |
| `USE_PARTNER_SPECIFIC_KEYS` | Reused match keys |
| `SET_MINIMUM_MATCH_COUNT` | Small results |
| `REVIEW_COMBINATION_RISK` | Combined datasets |
| `DELETE_AFTER_EXCHANGE` | Retained artifacts |
| `GATE_SECONDARY_USE` | Secondary use |
| `SHARE_ONLY_THE_MATCH_RESULT` | Overlap analysis or enrichment |
| `CONFIRM_RESEARCH_BASIS` | Patient or clinical research |
| `LIMIT_FRAUD_CHECK_SCOPE` | Fraud or anti-money-laundering checks |
| `CHECK_ADVERTISING_OPT_OUTS` | Advertising audience or measurement |
| `DOCUMENT_AI_TRAINING_DATA` | AI model training |
| `STANDARDIZE_IDENTIFIERS` | Inconsistent or unknown identifier formats (unscored) |
| `PLAN_REPEATABLE_ONBOARDING` | Several outside organizations |
| `RESTRICT_ACCESS` | Every assessment |
| `MINIMIZE_FIELDS` | Every assessment |
| `SET_LIFECYCLE_RESPONSIBILITIES` | Every assessment |
| `RECORD_THE_DECISION` | Every assessment |

## Result contract

API schema 3.0 returns one ordered `recommendations` list. Each item has `id`, `priority`, `title`, `action`, `rationale`, `basedOn` (readable labels for the answers that selected it, empty when it applies to every assessment), and `references` (`publisher`, `statement`, `sourceTitle`, `sourceUrl`). The response also carries `mappingVersion`, `mappingApprovalStatus`, and `sourcesCheckedOn`.

The frontend checks the response's shape and internal consistency, and displays what the backend returns.

## Changes

Changing the questions, wording, or scoring needs a new version.
