import { describeSensitiveFindings, findSensitiveData } from "./sensitive-data";

export const DATA_TYPE_LABELS = {
  names: "Names",
  emails: "Email addresses",
  phone: "Phone numbers",
  postal: "Postal addresses",
  device: "IP addresses or device IDs",
  adId: "Mobile advertising IDs",
  gov: "Government identifiers",
  health: "Health information",
  financial: "Financial information",
} as const;

export const PURPOSE_LABELS = {
  overlap: "Overlap analysis (finding records you have in common)",
  enrichment: "Data enrichment",
  healthResearch: "Patient or clinical research",
  fraud: "Fraud or anti-money-laundering checks",
  advertising: "Advertising audience or measurement",
  ai: "AI model training",
  analytics: "Internal analytics",
  other: "Other",
} as const;

export const REGULATION_LABELS = {
  gdpr: "GDPR or UK GDPR",
  hipaa: "HIPAA",
  ccpa: "CCPA/CPRA",
  none: "None of these",
  notSure: "Not sure",
} as const;

const YES_NO = { yes: "Yes", no: "No" } as const;
const YES_NO_UNSURE = { yes: "Yes", no: "No", notSure: "Not sure" } as const;

/** Single-answer questions. Wording is shared by the wizard and the downloadable report. */
export const CHOICE_QUESTIONS = {
  participants: {
    legend: "Who takes part in this work?",
    detail: "An outside organization is anyone beyond your own, such as a partner, vendor, agency, or research group.",
    options: { internal: "Internal teams only", onePartner: "One outside organization", multiplePartners: "Several outside organizations" },
  },
  environmentControl: {
    legend: "Who controls the environment and enforces the rules?",
    detail: "Think about who operates the system where the work happens, not who signed the contract.",
    options: { own: "Your organization", partner: "A partner", thirdParty: "A third-party platform", notSure: "Not sure" },
  },
  identifierProtection: {
    legend: "How will identifiers be protected when they are exchanged?",
    detail: "Identifiers are values that point to a person, such as an email address or government ID.",
    options: {
      notExchanged: "They are not exchanged",
      cleartext: "Not protected (readable values)",
      hashedTokenized: "Hashed or tokenized",
      encryptedDecrypted: "Encrypted, then decrypted by the recipient",
      cleanRoom: "Sent into a clean room",
      notSure: "Not sure",
    },
  },
  custodyChange: {
    legend: "Will identifiable or pseudonymous data end up in another party's custody?",
    detail: "Pseudonymous data has identifiers replaced, for example with hashes, but can still be linked back to a person.",
    options: YES_NO_UNSURE,
  },
  reusableKeys: {
    legend: "Will the same match key be reused across partners or over time?",
    detail: "A match key is the value used to find the same person in two datasets, such as a hashed email address.",
    options: YES_NO_UNSURE,
  },
  retainedArtifacts: {
    legend: "Will any party keep keys, hashes, tokens, or copies afterward?",
    detail: "Include anything kept by a vendor or platform operator after the work is done.",
    options: YES_NO_UNSURE,
  },
  smallResults: {
    legend: "Could a result involve so few people that someone can be singled out?",
    detail: "For example, a match that returns only a handful of people in a specific group.",
    options: YES_NO_UNSURE,
  },
  combined: {
    legend: "Will it be combined with other datasets?",
    detail: "Joining datasets can make someone identifiable even when neither set identified them on its own.",
    options: YES_NO,
  },
  secondaryUse: {
    legend: "Could it be reused beyond the purpose described?",
    detail: "Reuse means using the data later for something other than the purpose you described.",
    options: YES_NO,
  },
  identifierConsistency: {
    legend: "Are identifiers formatted consistently across sources?",
    detail: "For example, the same phone number format and address abbreviations in every dataset.",
    options: YES_NO_UNSURE,
  },
} as const;

export type ChoiceField = keyof typeof CHOICE_QUESTIONS;
export const CHOICE_FIELDS = Object.keys(CHOICE_QUESTIONS) as ChoiceField[];

/** Wording for the questions that aren't single-answer. */
export const QUESTION_LABELS = {
  dataTypes: "What information is involved?",
  purpose: "What is the intended use?",
  regulations: "Which rules may apply?",
} as const;

export const QUESTION_COUNT = Object.keys(QUESTION_LABELS).length + CHOICE_FIELDS.length;

export type DataType = keyof typeof DATA_TYPE_LABELS;
export type Purpose = keyof typeof PURPOSE_LABELS;
export type Regulation = keyof typeof REGULATION_LABELS;
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type AssessmentInput = {
  description: string;
  dataTypes: DataType[];
  purpose: Purpose;
  regulations: Regulation[];
} & { [Field in ChoiceField]: keyof (typeof CHOICE_QUESTIONS)[Field]["options"] | "" };

export type RiskFactor = {
  ruleId: string;
  category: string;
  label: string;
  points: number;
};

export type Reference = {
  publisher: string;
  statement: string;
  sourceTitle: string;
  sourceUrl: string;
};

export type Recommendation = {
  id: string;
  priority: number;
  title: string;
  action: string;
  rationale: string;
  basedOn: string[];
  references: Reference[];
};

export type AssessmentResult = {
  schemaVersion: string;
  rulesVersion: string;
  mappingVersion: string;
  mappingApprovalStatus: "pending" | "approved";
  sourcesCheckedOn: string;
  score: number;
  level: RiskLevel;
  guidance: string;
  factors: RiskFactor[];
  recommendations: Recommendation[];
  limitations: string[];
  assessedAt: string;
};

export const EMPTY_INPUT: AssessmentInput = {
  description: "",
  dataTypes: [],
  purpose: "overlap",
  regulations: [],
  ...(Object.fromEntries(CHOICE_FIELDS.map((field) => [field, ""])) as Record<ChoiceField, "">),
};

export const DESCRIPTION_MAX_LENGTH = 1000;
export const RISK_THRESHOLDS = { lowMax: 29, mediumMax: 59 } as const;

export function riskLevelFor(score: number): RiskLevel {
  return score <= RISK_THRESHOLDS.lowMax ? "LOW" : score <= RISK_THRESHOLDS.mediumMax ? "MEDIUM" : "HIGH";
}

/** "None of these" and "Not sure" replace any other selection, and vice versa. */
export function toggleRegulation(current: Regulation[], item: Regulation): Regulation[] {
  if (current.includes(item)) return current.filter((value) => value !== item);
  if (item === "none" || item === "notSure") return [item];
  return [...current.filter((value) => value !== "none" && value !== "notSure"), item];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUniqueValues(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function isSelectionOf(value: unknown, labels: object): boolean {
  return isStringArray(value)
    && value.every((item) => Object.hasOwn(labels, item))
    && hasUniqueValues(value);
}

export function isAssessmentInput(value: unknown): value is AssessmentInput {
  if (!isRecord(value)) return false;
  return typeof value.description === "string" && value.description.length <= DESCRIPTION_MAX_LENGTH
    && isSelectionOf(value.dataTypes, DATA_TYPE_LABELS)
    && isSelectionOf(value.regulations, REGULATION_LABELS)
    && CHOICE_FIELDS.every((field) => value[field] === ""
      || (typeof value[field] === "string" && Object.hasOwn(CHOICE_QUESTIONS[field].options, value[field])))
    && typeof value.purpose === "string" && Object.hasOwn(PURPOSE_LABELS, value.purpose);
}

export function validateDescription(value: string): string | null {
  const length = value.trim().length;
  if (length === 0) return "Describe the proposed data use case before continuing.";
  const sensitive = sensitiveDataMessage(value);
  if (sensitive) return sensitive;
  if (length < 20) return "Add a little more detail—include the data, who will use it, and why.";
  if (length > DESCRIPTION_MAX_LENGTH) {
    return `Keep the description to ${DESCRIPTION_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`;
  }
  return null;
}

/** Describe the kinds of data involved, never the data itself. Null when nothing personal was found. */
function sensitiveDataMessage(value: string): string | null {
  const findings = findSensitiveData(value);
  if (findings.length === 0) return null;
  return `Remove personal or confidential details before continuing. This description contains ${describeSensitiveFindings(findings)}. Describe the kinds of data instead, such as “customer email addresses.”`;
}

export function validateQuestions(input: AssessmentInput): string | null {
  if (input.dataTypes.length === 0) return "Select at least one type of information.";
  if (input.regulations.length === 0) return "Select the rules that may apply, or choose Not sure.";
  if (CHOICE_FIELDS.some((field) => !input[field])) {
    return "Answer every question before assessing the use case. Choose Not sure if you don't know yet.";
  }
  return null;
}

const SCHEMA_VERSION = "3.0";
export const ASSESSMENT_TIMEOUT_MS = 15_000;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRiskFactor(value: unknown): value is RiskFactor {
  if (!isRecord(value)) return false;
  return typeof value.ruleId === "string" && typeof value.category === "string"
    && typeof value.label === "string" && typeof value.points === "number"
    && Number.isInteger(value.points) && value.points >= 0;
}

function isReference(value: unknown): value is Reference {
  return isRecord(value)
    && isNonEmptyString(value.publisher)
    && isNonEmptyString(value.statement)
    && isNonEmptyString(value.sourceTitle)
    // These render as links, so only HTTPS destinations are accepted.
    && typeof value.sourceUrl === "string" && value.sourceUrl.startsWith("https://");
}

function isRecommendation(value: unknown): value is Recommendation {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && typeof value.priority === "number" && Number.isInteger(value.priority) && value.priority >= 1
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.action)
    && isNonEmptyString(value.rationale)
    && isStringArray(value.basedOn)
    && Array.isArray(value.references) && value.references.every(isReference);
}

/** The backend owns recommendation content; the client checks shape and internal consistency only. */
function isAssessmentResult(value: unknown): value is AssessmentResult {
  if (!isRecord(value)) return false;
  const basicShape = value.schemaVersion === SCHEMA_VERSION && typeof value.rulesVersion === "string"
    && typeof value.mappingVersion === "string"
    && (value.mappingApprovalStatus === "pending" || value.mappingApprovalStatus === "approved")
    && typeof value.sourcesCheckedOn === "string" && Number.isFinite(Date.parse(value.sourcesCheckedOn))
    && typeof value.score === "number" && Number.isInteger(value.score) && value.score >= 0 && value.score <= 100
    && ["LOW", "MEDIUM", "HIGH"].includes(value.level as string)
    && typeof value.guidance === "string"
    && Array.isArray(value.factors) && value.factors.every(isRiskFactor)
    && isStringArray(value.limitations)
    && Array.isArray(value.recommendations) && value.recommendations.every(isRecommendation)
    && typeof value.assessedAt === "string" && Number.isFinite(Date.parse(value.assessedAt));
  if (!basicShape) return false;

  const factors = value.factors as RiskFactor[];
  const recommendations = value.recommendations as Recommendation[];
  const score = value.score as number;
  const rawScore = factors.reduce((sum, factor) => sum + factor.points, 0);

  return hasUniqueValues(factors.map((factor) => factor.ruleId))
    && score === Math.min(100, rawScore)
    && value.level === riskLevelFor(score)
    && hasUniqueValues(recommendations.map((item) => item.id))
    && recommendations.every((item, index) => item.priority === index + 1);
}

export class AssessmentServiceError extends Error {
  constructor(public readonly status: number) {
    super(`Assessment service returned ${status}`);
    this.name = "AssessmentServiceError";
  }
}

/**
 * Only the fields the rubric uses leave the browser. The free-text
 * description stays client-side for the on-screen record and report.
 */
export function toScoringPayload(input: AssessmentInput): Omit<AssessmentInput, "description"> {
  const { dataTypes, purpose, regulations } = input;
  const answers = Object.fromEntries(CHOICE_FIELDS.map((field) => [field, input[field]]));
  return { dataTypes, purpose, regulations, ...answers } as Omit<AssessmentInput, "description">;
}

export async function requestAssessment(input: AssessmentInput, signal?: AbortSignal): Promise<AssessmentResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, ASSESSMENT_TIMEOUT_MS);
  try {
    const response = await fetch("/api/assessments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...toScoringPayload(input) }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new AssessmentServiceError(response.status);

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new Error("Assessment service returned an invalid response");
    }
    if (!isAssessmentResult(result)) throw new Error("Assessment service returned an invalid response");
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
