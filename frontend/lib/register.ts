import {
  ASSESSMENTS_ENDPOINT,
  type AssessmentInput,
  type AssessmentResult,
  DATA_TYPE_LABELS,
  EMPTY_INPUT,
  PURPOSE_LABELS,
  isAssessmentInput,
  isAssessmentResult,
  isRecord,
  isRiskLevel,
} from "./assessment";

/** Saved assessments are stored one row per version, and never hold the use-case description. */

export const REGISTER_PATH = "/assessments";
export const STATUS_LABELS = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
} as const;
type AssessmentStatus = keyof typeof STATUS_LABELS;
export const DESCRIPTION_NOT_SAVED = "Not saved. The description stays in the browser tab where it was written.";

export type SavedAssessmentVersion = {
  id: string;
  assessmentId: string;
  version: number;
  status: AssessmentStatus;
  input: AssessmentInput;
  result: AssessmentResult;
  savedAt: string;
};

export type RegisterEntry = {
  assessmentId: string;
  version: number;
  versionCount: number;
  status: AssessmentStatus;
  score: number;
  level: AssessmentResult["level"];
  title: string;
  savedAt: string;
};

export function assessmentPath(assessmentId: string, version?: number) {
  return `${REGISTER_PATH}/${assessmentId}${version ? `?version=${version}` : ""}`;
}

export function versionsEndpoint(assessmentId: string) {
  return `${ASSESSMENTS_ENDPOINT}/${assessmentId}/versions`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isStatus(value: unknown): value is AssessmentStatus {
  return typeof value === "string" && Object.hasOwn(STATUS_LABELS, value);
}

/** A name built from the answers alone, since the free-text description is never saved. */
export function assessmentTitle(input: Pick<AssessmentInput, "purpose" | "dataTypes">) {
  const purpose = PURPOSE_LABELS[input.purpose].replace(/\s*\(.*\)$/, "");
  const types = input.dataTypes.map((type) => DATA_TYPE_LABELS[type]);
  const shown = types.slice(0, 2).join(", ");
  return types.length > 2 ? `${purpose} · ${shown} +${types.length - 2} more` : `${purpose} · ${shown}`;
}

/** Saved rows never hold a description. */
export function answersToInput(answers: unknown): AssessmentInput | null {
  if (!isRecord(answers)) return null;
  const scored = Object.fromEntries(Object.entries(answers).filter(([key]) => key !== "schemaVersion"));
  const input = { ...EMPTY_INPUT, ...scored, description: "" };
  return isAssessmentInput(input) ? input : null;
}

type VersionRow = {
  id: string; assessment_id: string; version: number; status: string;
  answers: unknown; result: unknown; created_at: string;
};

export function toSavedVersion(row: VersionRow): SavedAssessmentVersion | null {
  const input = answersToInput(row.answers);
  if (!input || !isAssessmentResult(row.result) || !isStatus(row.status)) return null;
  return {
    id: row.id, assessmentId: row.assessment_id, version: row.version, status: row.status,
    input, result: row.result, savedAt: row.created_at,
  };
}

type RegisterRow = {
  assessment_id: string | null; version: number | null; version_count: number | null; status: string | null;
  score: number | null; risk_level: string | null; answers: unknown; saved_at: string | null;
};

export function toRegisterEntry(row: RegisterRow): RegisterEntry | null {
  const input = answersToInput(row.answers);
  if (!input || !row.assessment_id || !row.version || !row.version_count || row.score === null
    || !isStatus(row.status) || !isRiskLevel(row.risk_level) || !row.saved_at) return null;
  return {
    assessmentId: row.assessment_id, version: row.version, versionCount: row.version_count, status: row.status,
    score: row.score, level: row.risk_level, title: assessmentTitle(input), savedAt: row.saved_at,
  };
}

/** The viewer's local time by default; the server renders UTC until the browser takes over. */
export function formatSavedAt(value: string, timeZone?: "UTC") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const text = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
  return timeZone ? `${text} ${timeZone}` : text;
}
