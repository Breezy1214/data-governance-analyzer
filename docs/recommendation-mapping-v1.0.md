# Risk-to-safeguard mapping v1.0

Historical version. See [approved mapping v1.1](recommendation-mapping-v1.1.md)
for the current approval record and release. The v1.0 pending catalog is retained for replay.

Story: SCRUM-12. Epic: SCRUM-19. Requirements: FR-5 and FR-6. Dependencies: SCRUM-6 and scoring rules v1.0.

Status: **implemented proposal; stakeholder approval pending**. The SCRUM-6 rubric labels capability text "Approved MVP copy", but its overall status and product/privacy approval checklist remain pending. This implementation preserves that copy and its documented conditions; it does not claim that final approval has been obtained. Product/Privacy must approve the new factor-to-safeguard associations and Karlsgate must confirm capability wording and applicability before release.

## Source of truth

`backend/app/scoring/mappings/v1.0.json` contains the stable control IDs, wording, factor associations, baseline controls, capability conditions, scoring-version compatibility, and approval status. The backend validates references and full scoring-factor coverage when loading a catalog. Unsupported factors or versions fail explicitly rather than producing guessed recommendations.

The frontend receives a generated copy of the current catalog only (`frontend/lib/mappings/`), used to validate API responses. Do not edit the generated copy. From the repository root:

```sh
python scripts/sync-recommendation-mappings.py
python scripts/sync-recommendation-mappings.py --check
```

CI checks synchronization. Both runtimes test individual factors and all 1,152 combinations of one supported data type, six purposes, and five yes/no answers. Existing mixed-data tests verify highest-sensitivity scoring. Catalog tests also check capability text against SCRUM-6.

## General safeguards

These actions do not require a Karlsgate product. Baseline access control, field minimization, retention/deletion responsibilities, and purpose/accountability controls remain available in every assessment. Additional controls follow identified factors. Recommendations are deduplicated while retaining every contributing factor ID.

| Risk factor | Safeguards |
| --- | --- |
| High-sensitivity data | Access control, field minimization, retention/deletion, de-identification |
| Direct identifiers | Access control, field minimization, retention/deletion |
| External access | Access control, field minimization, purpose/accountability |
| Raw identifier exchange | Access control, field minimization, privacy-preserving matching |
| Data movement | Access control, field minimization, retention/deletion |
| Dataset combination | Field minimization, re-identification review |
| Secondary use | Purpose/accountability, retention/deletion, separate approval |
| Internal analytics | Field minimization, purpose/accountability |
| Research | Field minimization, purpose/accountability, retention/deletion |
| Record matching | Field minimization, privacy-preserving matching, purpose/accountability |
| Other purpose | Purpose/accountability, field minimization |
| Marketing | Purpose/accountability, field minimization, retention/deletion |
| AI development | Purpose/accountability, field minimization, retention/deletion |

The action sentences are reused from the existing recommendation implementation. The associations above are an engineering proposal for review, not a new legal or regulatory rubric.

## Karlsgate applicability

The catalog's `anyOfAllFactors` is OR across clauses and AND within a clause. An empty clause explicitly means every assessment. No free-text description is interpreted to infer product fit.

| Capability | Documented condition |
| --- | --- |
| Protected matching | External access AND (raw exchange OR matching purpose) |
| Re-identification risk remediation | Dataset combination |
| De-identification | Health, financial, or government identifier data |
| Data minimization | Every assessment, as specified by SCRUM-6 |
| Governance policy execution | Every assessment, as specified by SCRUM-6 |

For example, internal raw-data exchange still gets general access, minimization, and privacy-preserving matching safeguards, but not a Karlsgate protected-matching recommendation. The last two capabilities remain baseline fits under the current rubric; do not invent narrower eligibility rules without product-owner review. Removing or changing vendor applicability never removes general safeguards.

## Result contract and traceability

The request contract and scoring calculations remain v1.0. The additive response fields are:

- `mappingVersion`: the recommendation catalog version, independent of `rulesVersion`.
- `mappingApprovalStatus`: `pending` until an approved catalog is released.
- `generalSafeguards`: control `id`, exact `text`, and contributing `factorIds`.
- `karlsgateRecommendations`: capability `id`, `label`, exact `text`, `conditionId`, and factor evidence.

Empty factor evidence denotes a baseline control; otherwise IDs refer to entries in the result's `factors`. Legacy `recommendations` and `capabilities` arrays remain as text/label projections, with general safeguards only in `recommendations`. The UI and browser-generated PDF keep the two sections separate, explain controls with factor labels, and record mapping version and approval status. Structured API results retain IDs for machine-level auditing; the PDF intentionally uses plain-language labels.

Deploy the backend first or both applications together. The new frontend rejects responses without versioned recommendations rather than assigning misleading provenance to an old API result. The existing browser fallback uses this same catalog if the API is unavailable.

No assessment storage has been introduced. Results and PDF exports carry the version; structured operational logs include the version without questionnaire answers. Health/financial specialist-review caveats and the decision-support/not-legal-advice disclaimer remain. Nothing asserts legal compliance, guaranteed anonymity, or guaranteed risk elimination.

## Change procedure

1. Obtain Product/Privacy review of safeguards and Karlsgate approval of capability language/conditions; record the decision in the rubric/review history.
2. Add a new catalog file and version instead of overwriting a released version, including for approval-status or wording changes. Register it in `MAPPING_FILES`, update `CURRENT_MAPPING_VERSION`, and update the frontend catalog import. Retain old backend catalogs for explicit versioned replay.
3. Add or update applicability and factor-coverage tests, then regenerate the frontend copy. Include scoring-rule compatibility explicitly; a new scoring factor cannot ship without a safeguard mapping.
4. Run synchronization checks, backend lint/tests, and frontend lint/type checks/tests/build. Review the API result, on-screen recommendations, and PDF before merging.
