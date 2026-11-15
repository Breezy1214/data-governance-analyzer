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

/** A version as FastAPI returns it in GET /assessments/{id}. */
export function toSavedVersion(assessmentId: string, version: unknown): SavedAssessmentVersion | null {
  if (!isRecord(version)) return null;
  const input = answersToInput(version.answers);
  if (!input || !isAssessmentResult(version.result) || !isStatus(version.status)
    || typeof version.id !== "string" || typeof version.version !== "number" || typeof version.savedAt !== "string") {
    return null;
  }
  return {
    id: version.id, assessmentId, version: version.version, status: version.status,
    input, result: version.result, savedAt: version.savedAt,
  };
}

/** An entry as FastAPI returns it in GET /assessments. */
export function toRegisterEntry(entry: unknown): RegisterEntry | null {
  if (!isRecord(entry)) return null;
  const input = answersToInput(entry.answers);
  if (!input || typeof entry.assessmentId !== "string" || typeof entry.version !== "number"
    || typeof entry.versionCount !== "number" || typeof entry.score !== "number" || !isStatus(entry.status)
    || !isRiskLevel(entry.level) || typeof entry.savedAt !== "string") return null;
  return {
    assessmentId: entry.assessmentId, version: entry.version, versionCount: entry.versionCount, status: entry.status,
    score: entry.score, level: entry.level, title: assessmentTitle(input), savedAt: entry.savedAt,
  };
}

/** The viewer's local time by default; the server renders UTC until the browser takes over. */
export function formatSavedAt(value: string, timeZone?: "UTC") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const text = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
  return timeZone ? `${text} ${timeZone}` : text;
}
