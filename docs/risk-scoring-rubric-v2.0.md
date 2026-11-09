# Risk-scoring rubric v2.0

Status: **approved**
Owner: Product / Privacy
Applies to: questionnaire schema 3.0 and recommendation catalog v2.0
Supersedes: rubric v1.0

The score is transparent and deterministic. Add the points for each applicable response, cap the result at 100, and map it to a risk level. A score supports triage; it does not determine legal or regulatory compliance.

Thresholds are unchanged from v1.0.

## Thresholds

| Score | Level | Decision guidance |
| --- | --- | --- |
| 0–29 | Low | Standard safeguards and an accountable owner are likely sufficient. |
| 30–59 | Medium | Proceed only after the listed controls and an accountable review are in place. |
| 60–100 | High | Pause implementation until privacy, security, and governance controls are approved. |

## Response-to-score mapping

"Not sure" scores the same as the riskier answer, because an unknown control can't be relied on.

| Factor | Response | Points | Rule ID |
| --- | --- | ---: | --- |
| Data sensitivity | Any government, health, or financial data | 24 | `DATA_SENSITIVITY_HIGH` |
| Data sensitivity | Other identifiers and no high-sensitivity category | 12 | `DATA_SENSITIVITY_DIRECT` |
| Participants | One outside organization | 12 | `PARTICIPANTS_ONE` |
| Participants | Several outside organizations | 16 | `PARTICIPANTS_MULTIPLE` |
| Identifier protection | Not protected (readable values) | 18 | `IDENTIFIERS_CLEARTEXT` |
| Identifier protection | Not sure | 18 | `IDENTIFIERS_UNKNOWN` |
| Identifier protection | Hashed or tokenized | 12 | `IDENTIFIERS_HASHED` |
| Identifier protection | Encrypted, then decrypted by the recipient | 12 | `IDENTIFIERS_DECRYPTED` |
| Identifier protection | Sent into a clean room | 6 | `IDENTIFIERS_CLEAN_ROOM` |
| Custody | Yes or not sure | 10 | `CUSTODY_CHANGE` |
| Environment control | Partner, third-party platform, or not sure | 6 | `ENVIRONMENT_NOT_OWNED` |
| Reused match keys | Yes or not sure | 8 | `REUSABLE_KEYS` |
| Small results | Yes or not sure | 6 | `SMALL_RESULTS` |
| Combination | Yes | 8 | `COMBINED_REIDENTIFICATION` |
| Retained artifacts | Yes or not sure | 8 | `RETAINED_ARTIFACTS` |
| Secondary use | Yes | 8 | `SECONDARY_USE` |
| Intended use | Internal analytics | 2 | `PURPOSE_ANALYTICS` |
| Intended use | Overlap analysis | 4 | `PURPOSE_OVERLAP` |
| Intended use | Fraud or anti-money-laundering checks | 4 | `PURPOSE_FRAUD` |
| Intended use | Data enrichment | 6 | `PURPOSE_ENRICHMENT` |
| Intended use | Patient or clinical research | 6 | `PURPOSE_HEALTH_RESEARCH` |
| Intended use | Other | 6 | `PURPOSE_OTHER` |
| Intended use | Advertising audience or measurement | 8 | `PURPOSE_ADVERTISING` |
| Intended use | AI model training | 8 | `PURPOSE_AI` |

"Internal teams only", "They are not exchanged", "Your organization", and "No" add zero points. Only the highest data-sensitivity score applies. Weights were lowered from v1.0 so that more questions don't push ordinary use cases to the cap.

## Unscored answers

| Question | Effect |
| --- | --- |
| Which rules may apply? | Adds specialist-review notes. "HIPAA" or health data adds a HIPAA note, and financial data adds a PCI DSS note. |
| Are identifiers formatted consistently across sources? | "No" or "Not sure" adds the identifier-standardization recommendation. |

## Limitations

- The tool flags specialist review but does not determine compliance with HIPAA, PCI DSS, GDPR, CCPA/CPRA, or any other regulation.
- It does not replace privacy, security, procurement, legal, or records-management approval.
- Jurisdiction details, contractual restrictions, minors' data, biometrics, precise location, and data volume are not scored.

## Changes

Changing the questions, thresholds, point values, or wording needs a new version. `backend/tests/test_scoring.py` checks that the backend matches this rubric.
