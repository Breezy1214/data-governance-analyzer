import { vi } from "vitest";
import type { AssessmentResult } from "../lib/assessment";
import { mapRecommendations, type RecommendationResult } from "../lib/recommendations";

const baseResult: Omit<AssessmentResult, keyof RecommendationResult> = {
  schemaVersion: "2.0",
  rulesVersion: "1.0",
  score: 100,
  level: "HIGH",
  guidance: "Pause implementation until privacy, security, and governance controls are approved.",
  factors: [
    {
      ruleId: "DATA_SENSITIVITY_HIGH",
      category: "data_sensitivity",
      label: "Regulated or highly sensitive information",
      points: 28,
    },
    {
      ruleId: "EXTERNAL_ACCESS",
      category: "access",
      label: "Access by another organization",
      points: 18,
    },
    {
      ruleId: "RAW_EXCHANGE",
      category: "access",
      label: "Raw identifier exchange",
      points: 18,
    },
    { ruleId: "DATA_MOVEMENT", category: "movement", label: "Data leaves its controlled environment", points: 12 },
    { ruleId: "COMBINED_REIDENTIFICATION", category: "reidentification", label: "Re-identification potential from data combination", points: 12 },
    { ruleId: "SECONDARY_USE", category: "purpose", label: "Reuse beyond the stated purpose", points: 12 },
    { ruleId: "PURPOSE_RESEARCH", category: "purpose", label: "Intended use: Research", points: 4 },
  ],
  recommendationDetails: [
    {
      id: "PROTECTED_MATCHING",
      priority: 1,
      title: "Protect cross-party matching",
      action: "Use protected matching instead of transferring raw identifiers.",
      rationale: "Another organization will participate in matching or receive identifiable data, so identifiers should remain protected across that boundary.",
      riskFactorIds: ["EXTERNAL_ACCESS", "RAW_EXCHANGE"],
    },
    {
      id: "REIDENTIFICATION_REVIEW",
      priority: 2,
      title: "Reduce combination risk",
      action: "Measure and remediate re-identification risk before combining datasets.",
      rationale: "Linking datasets can reveal a person or sensitive attribute even when each source appears limited on its own.",
      riskFactorIds: ["COMBINED_REIDENTIFICATION"],
    },
    {
      id: "DEIDENTIFY_SENSITIVE_DATA",
      priority: 3,
      title: "De-identify sensitive records",
      action: "De-identify sensitive records before they leave the originating system.",
      rationale: "Regulated or high-impact information increases potential harm if directly identifying values remain exposed.",
      riskFactorIds: ["DATA_SENSITIVITY_HIGH", "DATA_MOVEMENT"],
    },
    {
      id: "SECONDARY_USE_GATE",
      priority: 4,
      title: "Gate any secondary use",
      action: "Create a separate approval gate for any secondary use.",
      rationale: "Reuse beyond the stated purpose can exceed the original notice, consent, contract, or policy basis.",
      riskFactorIds: ["SECONDARY_USE"],
    },
    {
      id: "ROLE_BASED_ACCESS",
      priority: 5,
      title: "Restrict and review access",
      action: "Limit access to named roles and review permissions regularly.",
      rationale: "Named ownership and periodic review reduce unnecessary exposure throughout the approved use.",
      riskFactorIds: ["EXTERNAL_ACCESS", "RAW_EXCHANGE", "DATA_MOVEMENT", "PURPOSE_RESEARCH"],
    },
    {
      id: "FIELD_MINIMIZATION",
      priority: 6,
      title: "Minimize the data",
      action: "Collect and share only the fields required for the approved purpose.",
      rationale: "Using fewer fields reduces the impact of every identified data-sensitivity and purpose risk.",
      riskFactorIds: ["DATA_SENSITIVITY_HIGH", "PURPOSE_RESEARCH"],
    },
    {
      id: "RETENTION_AND_RESPONSE",
      priority: 7,
      title: "Set lifecycle responsibilities",
      action: "Set retention, deletion, and incident-response responsibilities before launch.",
      rationale: "A defined lifecycle limits how long risk persists and makes ownership clear if an incident occurs.",
      riskFactorIds: ["DATA_MOVEMENT", "SECONDARY_USE", "PURPOSE_RESEARCH"],
    },
    {
      id: "GOVERNANCE_RECORD",
      priority: 8,
      title: "Record the decision",
      action: "Record the approved purpose, data owner, and control evidence in the governance register.",
      rationale: "A reviewable record connects the approved use and its safeguards to the risks identified in this assessment.",
      riskFactorIds: [
        "DATA_SENSITIVITY_HIGH",
        "EXTERNAL_ACCESS",
        "RAW_EXCHANGE",
        "DATA_MOVEMENT",
        "COMBINED_REIDENTIFICATION",
        "SECONDARY_USE",
        "PURPOSE_RESEARCH",
      ],
    },
  ],
  capabilities: [
    "Protected matching",
    "Re-identification risk remediation",
    "De-identification",
    "Data minimization",
    "Governance policy execution",
  ],
  limitations: [
    "HIPAA applicability and required agreements need specialist review; this MVP does not determine compliance.",
    "PCI DSS scope depends on the exact account data involved; this MVP does not determine compliance.",
  ],
  assessedAt: "2026-09-23T15:00:00.000Z",
};

export const assessmentResult: AssessmentResult = {
  ...baseResult,
  ...mapRecommendations(baseResult.factors.map((factor) => factor.ruleId), baseResult.rulesVersion),
};
/** A fetch that never settles until its request is aborted. */
export function hangingFetch(_url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
}

/** Stubs global fetch to answer every call with `response` (or reject with it). */
export function stubAssessmentApi(response: Response | Error = new Response(JSON.stringify(assessmentResult))) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response.clone();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
