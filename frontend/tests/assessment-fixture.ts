import { vi } from "vitest";
import { AssessmentInput, AssessmentResult, EMPTY_INPUT } from "../lib/assessment";

/** Answers matching `assessmentResult` below; every question is complete. */
export const completeInput: AssessmentInput = {
  ...EMPTY_INPUT,
  description: "Match loyalty member emails and health survey answers with a research partner.",
  dataTypes: ["emails", "health"],
  purpose: "healthResearch",
  regulations: ["hipaa"],
  participants: "onePartner",
  environmentControl: "thirdParty",
  identifierProtection: "hashedTokenized",
  custodyChange: "yes",
  reusableKeys: "notSure",
  retainedArtifacts: "yes",
  smallResults: "no",
  combined: "yes",
  secondaryUse: "yes",
  identifierConsistency: "no",
};

export const assessmentResult: AssessmentResult = {
  schemaVersion: "3.0",
  rulesVersion: "2.0",
  apiVersion: "0.1.0",
  mappingVersion: "2.0",
  mappingApprovalStatus: "approved",
  sourcesCheckedOn: "2026-11-04",
  score: 100,
  level: "HIGH",
  guidance: "Pause implementation until privacy, security, and governance controls are approved.",
  factors: [
    { ruleId: "DATA_SENSITIVITY_HIGH", category: "data_sensitivity", label: "Regulated or highly sensitive information", points: 24 },
    { ruleId: "PARTICIPANTS_ONE", category: "access", label: "One outside organization takes part", points: 12 },
    { ruleId: "IDENTIFIERS_HASHED", category: "identifiers", label: "Identifiers exchanged as hashes or tokens", points: 12 },
    { ruleId: "CUSTODY_CHANGE", category: "custody", label: "Data may end up in another party's custody", points: 10 },
    { ruleId: "ENVIRONMENT_NOT_OWNED", category: "custody", label: "Your organization may not control the environment or enforce the rules", points: 6 },
    { ruleId: "REUSABLE_KEYS", category: "reidentification", label: "Match keys may be reused across partners or over time", points: 8 },
    { ruleId: "COMBINED_REIDENTIFICATION", category: "reidentification", label: "Re-identification potential from data combination", points: 8 },
    { ruleId: "RETAINED_ARTIFACTS", category: "lifecycle", label: "Keys, hashes, tokens, or copies may be kept afterward", points: 8 },
    { ruleId: "SECONDARY_USE", category: "purpose", label: "Reuse beyond the stated purpose", points: 8 },
    { ruleId: "PURPOSE_HEALTH_RESEARCH", category: "purpose", label: "Intended use: Patient or clinical research", points: 6 },
  ],
  recommendations: [
    {
      id: "TREAT_HASHES_AS_PERSONAL_DATA",
      priority: 1,
      title: "Treat hashes and tokens as personal data",
      action: "Handle hashed or tokenized identifiers as personal data, and use single-use salted keys instead of stable hashes.",
      rationale: "The same input always produces the same hash, so a stable hash can work as a lasting identifier for a person.",
      basedOn: ["Identifiers exchanged as hashes or tokens"],
      references: [
        {
          publisher: "GDPR Recital 26",
          statement: "Recital 26 says pseudonymised data should be treated as information on an identifiable person.",
          sourceTitle: "GDPR Recital 26 (text reprinted at gdpr-info.eu)",
          sourceUrl: "https://gdpr-info.eu/recitals/no-26/",
        },
      ],
    },
    {
      id: "GATE_SECONDARY_USE",
      priority: 2,
      title: "Gate any secondary use",
      action: "Create a separate approval gate for any secondary use.",
      rationale: "Reuse beyond the stated purpose can exceed the original notice, consent, contract, or policy basis.",
      basedOn: ["Reuse beyond the stated purpose"],
      references: [],
    },
    {
      id: "SET_LIFECYCLE_RESPONSIBILITIES",
      priority: 3,
      title: "Set lifecycle responsibilities",
      action: "Set retention, deletion, and incident-response responsibilities before launch.",
      rationale: "A defined lifecycle limits how long risk persists and makes ownership clear if an incident occurs.",
      basedOn: [],
      references: [],
    },
  ],
  limitations: [
    "HIPAA applicability and required agreements need specialist review; this tool does not determine compliance.",
  ],
  assessedAt: "2026-09-23T15:00:00.000Z",
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
