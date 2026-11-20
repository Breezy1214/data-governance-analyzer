import "server-only";
import { notFound } from "next/navigation";
import { isRecord, isRiskLevel } from "./assessment";
import { readFromBackend } from "./backend-proxy";
import { answersToInput, assessmentTitle } from "./register";
import type { ReviewContext, ReviewWorkspace } from "./review";

export async function reviewWorkspaces(token: string): Promise<ReviewWorkspace[]> {
  return await readFromBackend("/reviews/workspaces", token) as ReviewWorkspace[];
}

export async function reviewContext(token: string, versionId: string): Promise<ReviewContext> {
  const context = await readFromBackend(`/reviews/versions/${versionId}`, token);
  if (!context) notFound();
  return context as ReviewContext;
}

/** A submission awaiting the viewer's decision, as FastAPI returns it in GET /reviews/queue. */
function toQueueEntry(entry: unknown) {
  if (!isRecord(entry)) return null;
  const input = answersToInput(entry.answers);
  if (!input || typeof entry.id !== "string" || typeof entry.assessmentId !== "string" || typeof entry.version !== "number"
    || typeof entry.score !== "number" || !isRiskLevel(entry.level) || typeof entry.savedAt !== "string"
    || typeof entry.workspace !== "string") return null;
  return {
    id: entry.id, assessmentId: entry.assessmentId, version: entry.version, title: assessmentTitle(input),
    score: entry.score, level: entry.level, savedAt: entry.savedAt, workspace: entry.workspace,
  };
}

export async function reviewQueue(token: string) {
  const rows = await readFromBackend("/reviews/queue", token);
  return (Array.isArray(rows) ? rows : []).map(toQueueEntry).filter((entry) => entry !== null);
}
