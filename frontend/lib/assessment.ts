import { matchesRecommendationResult, type RecommendationResult } from "./recommendations";

export const DATA_TYPE_LABELS = {
  names: "Names",
  emails: "Email addresses",
  phone: "Phone numbers",
  gov: "Government identifiers",
  health: "Health information",
  financial: "Financial information",
} as const;

export const PURPOSE_LABELS = {
  matching: "Customer or record matching",
  ai: "AI model training or development",
  analytics: "Internal analytics",
  marketing: "Marketing or advertising",
  research: "Research",
  other: "Other",
} as const;

/** Question wording, shared by the wizard and the downloadable report. */
export const QUESTION_LABELS = {
  dataTypes: "What information is involved?",
  externalAccess: "Will another organization access the data?",
  rawExchange: "Will raw identifiable values be exchanged?",
  dataMovement: "Will data leave its current controlled environment?",
  combined: "Will it be combined with other datasets?",
  secondaryUse: "Could it be reused beyond the purpose described?",
  purpose: "What is the intended use?",
} as const;


export type DataType = keyof typeof DATA_TYPE_LABELS;
export type Purpose = keyof typeof PURPOSE_LABELS;
export type YesNo = "yes" | "no";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type AssessmentInput = {
  description: string;
  dataTypes: DataType[];
  externalAccess: YesNo | "";
  rawExchange: YesNo | "";
  dataMovement: YesNo | "";
  combined: YesNo | "";
  secondaryUse: YesNo | "";
  purpose: Purpose;
};

export type RiskFactor = {
  ruleId: string;
  category: string;
  label: string;
  points: number;
};

export type RecommendationDetail = {
  id: string;
  priority: number;
  title: string;
  action: string;
  rationale: string;
  riskFactorIds: string[];
};

export type AssessmentResult = RecommendationResult & {
  schemaVersion: string;
  rulesVersion: string;
  score: number;
  level: RiskLevel;
  guidance: string;
  factors: RiskFactor[];
  recommendationDetails: RecommendationDetail[];
  capabilities: string[];
  limitations: string[];
  assessedAt: string;
};

export const EMPTY_INPUT: AssessmentInput = {
  description: "",
  dataTypes: [],
  externalAccess: "",
  rawExchange: "",
  dataMovement: "",
  combined: "",
  secondaryUse: "",
  purpose: "matching",
};

export const BINARY_FIELDS = ["externalAccess", "rawExchange", "dataMovement", "combined", "secondaryUse"] as const;
export const DESCRIPTION_MAX_LENGTH = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUniqueValues(values: string[]): boolean {
  return new Set(values).size === values.length;
}

export function isAssessmentInput(value: unknown): value is AssessmentInput {
  if (!isRecord(value)) return false;
  const dataTypes = value.dataTypes;
  return typeof value.description === "string" && value.description.length <= DESCRIPTION_MAX_LENGTH
    && Array.isArray(dataTypes)
    && dataTypes.every((item) => typeof item === "string" && Object.hasOwn(DATA_TYPE_LABELS, item))
    && hasUniqueValues(dataTypes)
    && BINARY_FIELDS.every((field) => ["", "yes", "no"].includes(value[field] as string))
    && typeof value.purpose === "string" && Object.hasOwn(PURPOSE_LABELS, value.purpose);
}

export function validateDescription(value: string): string | null {
  const length = value.trim().length;
  if (length === 0) return "Describe the proposed data use case before continuing.";
  if (length < 20) return "Add a little more detail—include the data, who will use it, and why.";
  if (length > DESCRIPTION_MAX_LENGTH) {
    return `Keep the description to ${DESCRIPTION_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`;
  }
  return null;
}

export function validateQuestions(input: AssessmentInput): string | null {
  if (input.dataTypes.length === 0) return "Select at least one type of information.";
  if (BINARY_FIELDS.some((field) => input[field] !== "yes" && input[field] !== "no")) {
    return "Answer each Yes or No question before assessing the use case.";
  }
  return null;
}

const SCHEMA_VERSION = "2.0";
export const ASSESSMENT_TIMEOUT_MS = 15_000;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRiskFactor(value: unknown): value is RiskFactor {
  if (!isRecord(value)) return false;
  return typeof value.ruleId === "string" && typeof value.category === "string"
    && typeof value.label === "string" && typeof value.points === "number"
    && Number.isInteger(value.points) && value.points >= 0;
}

function isRecommendationDetail(value: unknown): value is RecommendationDetail {
  return isRecord(value)
    && typeof value.id === "string" && value.id.length > 0
    && typeof value.priority === "number" && Number.isInteger(value.priority) && value.priority >= 1
    && typeof value.title === "string" && value.title.length > 0
    && typeof value.action === "string" && value.action.length > 0
    && typeof value.rationale === "string" && value.rationale.length > 0
    && isStringArray(value.riskFactorIds) && value.riskFactorIds.length > 0;
}

function isAssessmentResult(value: unknown): value is AssessmentResult {
  if (!isRecord(value)) return false;
  const basicShape = value.schemaVersion === SCHEMA_VERSION && typeof value.rulesVersion === "string"
    && typeof value.score === "number" && Number.isInteger(value.score) && value.score >= 0 && value.score <= 100
    && ["LOW", "MEDIUM", "HIGH"].includes(value.level as string)
    && typeof value.guidance === "string"
    && Array.isArray(value.factors) && value.factors.every(isRiskFactor)
    && [value.capabilities, value.limitations].every(isStringArray)
    && Array.isArray(value.recommendationDetails) && value.recommendationDetails.every(isRecommendationDetail)
    && typeof value.assessedAt === "string" && Number.isFinite(Date.parse(value.assessedAt));
  if (!basicShape) return false;

  const factors = value.factors as RiskFactor[];
  const factorIdList = factors.map((factor) => factor.ruleId);
  if (!hasUniqueValues(factorIdList)) return false;
  if (!matchesRecommendationResult(value, factorIdList, value.rulesVersion as string)) return false;
  const mapped = value as unknown as RecommendationResult;
  if (JSON.stringify(value.capabilities) !== JSON.stringify(mapped.karlsgateRecommendations.map((item) => item.label))) return false;
  const factorIds = new Set(factorIdList);
  const details = value.recommendationDetails as RecommendationDetail[];
  const score = value.score as number;
  const level = value.level as RiskLevel;
  const rawScore = factors.reduce((sum, factor) => sum + factor.points, 0);
  const expectedLevel: RiskLevel = score <= 29 ? "LOW" : score <= 59 ? "MEDIUM" : "HIGH";

  return score === Math.min(100, rawScore)
    && level === expectedLevel
    && hasUniqueValues(details.map((detail) => detail.id))
    && details.every((detail, index) => detail.priority === index + 1
      && hasUniqueValues(detail.riskFactorIds)
      && detail.riskFactorIds.every((ruleId) => factorIds.has(ruleId)));
}

export class AssessmentServiceError extends Error {
  constructor(public readonly status: number) {
    super(`Assessment service returned ${status}`);
    this.name = "AssessmentServiceError";
  }
}

/**
 * Only the fields the rubric scores leave the browser. The free-text
 * description stays client-side for the on-screen record and report.
 */
export function toScoringPayload(input: AssessmentInput): Omit<AssessmentInput, "description"> {
  const { dataTypes, externalAccess, rawExchange, dataMovement, combined, secondaryUse, purpose } = input;
  return { dataTypes, externalAccess, rawExchange, dataMovement, combined, secondaryUse, purpose };
}

export async function requestAssessment(input: AssessmentInput, signal?: AbortSignal): Promise<AssessmentResult> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) {
    throw new Error("Assessment service is not configured");
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, ASSESSMENT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/assessments`, {
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
