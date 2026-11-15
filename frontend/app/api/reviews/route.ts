import { authenticatedSession, AuthenticationError, json, sameOriginRoute } from "@/lib/auth-server";
import { isUuid } from "@/lib/register";
import { reviewActions, type ReviewStatus } from "@/lib/review";
import { reviewClient, reviewContext, reviewFailure, reviewWorkspaces } from "@/lib/review-server";

export const POST = sameOriginRoute(async (request: Request) => {
  const { client, payload } = await authenticatedSession();
  // Bound the stream too: Content-Length alone is not a safe input limit.
  const reader = request.body?.getReader();
  if (!reader) throw new AuthenticationError(400, "A request is required.");
  let text = "", size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 12000) { await reader.cancel(); throw new AuthenticationError(413, "Request too large."); }
    text += decoder.decode(value, { stream: true });
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(text + decoder.decode()); } catch { throw new AuthenticationError(400, "Invalid request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AuthenticationError(400, "Invalid request.");
  const db = reviewClient(client);
  if (body.action === "create") {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100) throw new AuthenticationError(400, "Enter a workspace name up to 100 characters.");
    const { error } = await db.rpc("create_review_workspace", { workspace_name: body.name.trim() });
    reviewFailure(error);
  } else if (body.action === "member") {
    if (!isUuid(body.workspaceId) || !isUuid(body.userId) || !(body.role === null || ["submitter", "reviewer", "admin"].includes(String(body.role)))) throw new AuthenticationError(400, "Invalid membership.");
    const spaces = await reviewWorkspaces(client, payload.user.id);
    if (spaces.find((w) => w.id === body.workspaceId)?.role !== "admin" || body.userId === payload.user.id) throw new AuthenticationError(403, "You cannot change this membership.");
    const { error } = await db.rpc("set_review_member", { w: body.workspaceId, member_id: body.userId, member_role: body.role as string | null });
    reviewFailure(error);
  } else if (body.action === "transition") {
    if (!isUuid(body.versionId) || !(body.workspaceId === null || isUuid(body.workspaceId)) || typeof body.note !== "string" || body.note.trim().length > 2000
      || !["in_review", "approved", "rejected", "changes_requested"].includes(String(body.status)) || typeof body.expectedStatus !== "string") throw new AuthenticationError(400, "Invalid review request.");
    const context = await reviewContext(client, body.versionId, payload.user.id);
    const state = body.expectedStatus === "in_review" && !context.workspaceId ? "draft" : body.expectedStatus as ReviewStatus;
    const actions: readonly string[] = reviewActions(state, context.ownerId === payload.user.id, context.role);
    if (!actions.includes(String(body.status))) throw new AuthenticationError(403, "This review action is not permitted.");
    if (body.status === "in_review") {
      const spaces = await reviewWorkspaces(client, payload.user.id);
      if (!spaces.some((w) => w.id === body.workspaceId)) throw new AuthenticationError(403, "Choose a workspace you belong to.");
    } else if (!body.note.trim()) throw new AuthenticationError(400, "Add a comment explaining your decision.");
    const { error } = await db.rpc("transition_review", { v_id: body.versionId, w_id: body.workspaceId,
      next_status: String(body.status), note: body.note.trim(), expected_status: body.expectedStatus });
    reviewFailure(error);
  } else throw new AuthenticationError(400, "Unknown review action.");
  return json({ ok: true });
});
