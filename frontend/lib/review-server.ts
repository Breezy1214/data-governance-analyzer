import "server-only";
import { notFound } from "next/navigation";
import { readFromBackend } from "./backend-proxy";
import type { ReviewContext, ReviewWorkspace, ReviewStatus } from "./review";

export async function reviewWorkspaces(token: string): Promise<ReviewWorkspace[]> {
  return await readFromBackend("/reviews/workspaces", token) as ReviewWorkspace[];
}
export async function reviewContext(token: string, versionId: string): Promise<ReviewContext> {
  const context = await readFromBackend(`/reviews/versions/${versionId}`, token);
  if (!context) notFound();
  return context as ReviewContext;
}
export type ReviewQueueEntry = { id: string; assessment_id: string; version: number; status: ReviewStatus };
export async function reviewQueue(token: string): Promise<ReviewQueueEntry[]> {
  return await readFromBackend("/reviews/queue", token) as ReviewQueueEntry[];
}
