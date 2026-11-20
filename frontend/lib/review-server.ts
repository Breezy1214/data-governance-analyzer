import "server-only";
import { notFound } from "next/navigation";
import { readFromBackend } from "./backend-proxy";
import { isRecord } from "./assessment";
import { type SavedAssessmentVersion, toSavedVersion } from "./register";
import type { ReviewContext, ReviewWorkspace } from "./review";

export async function reviewWorkspaces(token: string): Promise<ReviewWorkspace[]> {
  return await readFromBackend("/reviews/workspaces", token) as ReviewWorkspace[];
}

export async function reviewContext(token: string, versionId: string): Promise<ReviewContext> {
  const context = await readFromBackend(`/reviews/versions/${versionId}`, token);
  if (!context) notFound();
  return context as ReviewContext;
}

type ReviewQueueEntry = SavedAssessmentVersion & { workspace: string };

export async function reviewQueue(token: string): Promise<ReviewQueueEntry[]> {
  const rows = await readFromBackend("/reviews/queue", token);
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (!isRecord(row) || typeof row.assessment_id !== "string" || typeof row.workspace !== "string") return [];
    const version = toSavedVersion(row.assessment_id, { ...row, savedAt: row.created_at });
    return version ? [{ ...version, workspace: row.workspace }] : [];
  });
}
