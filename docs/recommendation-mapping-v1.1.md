# Risk-to-safeguard mapping v1.1

Story: SCRUM-12. Epic: SCRUM-19. Requirements: FR-5 and FR-6.

Status: **stakeholder approved**.

## Approval Record

On October 7, 2026, the project contributor confirmed in the project conversation
that the stakeholder had approved SCRUM 12. This record reflects that confirmation;
no stakeholder name or separate signed approval document was supplied.

Approval covers the SCRUM 12 safeguard associations, capability wording, and
documented applicability conditions. This is not a legal compliance certification
or an approval of unrelated scoring thresholds. Existing legal/privacy limitations
and specialist-review notices remain unchanged.

## Release Changes

- Catalog `backend/app/scoring/mappings/v1.1.json` sets `version` to `1.1` and
  `approvalStatus` to `approved`.
- Safeguard text, associations, and capability conditions are unchanged from v1.0.
- API results, the on-screen assessment record, and PDF exports carry the new
  mapping version and approval status.
- Catalog v1.0 remains immutable and can still be replayed explicitly with its
  original pending status. Scoring rules and the request schema remain unchanged
  by this approval release.
- The frontend catalog is generated with
  `python scripts/sync-recommendation-mappings.py` and checked by CI.

The original [mapping specification](recommendation-mapping-v1.0.md) documents
the factor coverage, conditions, and result contract. Its pending status is
historical; this release supersedes it for current assessments.

## Integration

SCRUM 12 targets `dev`, not `main`, and is integrated with the team's v2 assessment
contract. Scoring remains server-only. Prioritized `recommendationDetails` retain
their rationale and factor references; additional mapped safeguards are appended
when not already represented. The legacy `recommendations` field is not returned.

Results also include `mappingVersion`, `mappingApprovalStatus`, `generalSafeguards`,
and `karlsgateRecommendations`. The frontend checks these against the versioned
catalog and only displays applicable, approved capability wording. The UI and PDF
separate general safeguards from Karlsgate capabilities and show mapping provenance.
Request cancellation, draft handling, validation, and the team's updated styling
are preserved. No browser-side scoring fallback is used.
