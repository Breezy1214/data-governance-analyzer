import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { AuthenticationError } from "./auth-server";
import type { ReviewContext, ReviewEvent, ReviewRole, ReviewWorkspace } from "./review";

// Additive types for the new migration; the register's generated schema is left intact.
type Table<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };
type WorkflowDatabase = Omit<Database, "public"> & { public: Omit<Database["public"], "Tables" | "Functions"> & {
  Tables: Database["public"]["Tables"] & {
    review_workspaces: Table<{ id: string; name: string }>;
    review_members: Table<{ workspace_id: string; user_id: string; role: ReviewRole }>;
    version_reviews: Table<{ version_id: string; workspace_id: string }>;
    review_events: Table<ReviewEvent>;
  };
  Functions: Database["public"]["Functions"] & {
    create_review_workspace: { Args: { workspace_name: string }; Returns: string };
    set_review_member: { Args: { w: string; member_id: string; member_role: string | null }; Returns: undefined };
    transition_review: { Args: { v_id: string; w_id: string | null; next_status: string; note: string; expected_status: string }; Returns: undefined };
  };
} };
export const reviewClient = (client: SupabaseClient<Database>) => client as unknown as SupabaseClient<WorkflowDatabase>;
export function reviewFailure(error: { code?: string } | null) {
  if (!error) return;
  const status = error.code === "42501" ? 403 : error.code === "40001" ? 409
    : ["22023", "23514", "23503"].includes(error.code ?? "") ? 400 : 503;
  throw new AuthenticationError(status, status === 409 ? "This record changed. Reload before trying again."
    : status === 403 ? "You do not have permission to do this."
    : status === 400 ? "Check the selected account, workspace, and comment." : "Reviews are unavailable. Please try again.");
}
export async function reviewWorkspaces(client: SupabaseClient<Database>, userId: string): Promise<ReviewWorkspace[]> {
  const db = reviewClient(client);
  const [spaces, members] = await Promise.all([
    db.from("review_workspaces").select("id,name"),
    db.from("review_members").select("workspace_id,user_id,role").eq("user_id", userId),
  ]);
  reviewFailure(spaces.error); reviewFailure(members.error);
  return (spaces.data ?? []).flatMap((w) => {
    const member = members.data?.find((m) => m.workspace_id === w.id);
    return member ? [{ ...w, role: member.role }] : [];
  });
}
export async function reviewContext(client: SupabaseClient<Database>, versionId: string, userId: string): Promise<ReviewContext> {
  const db = reviewClient(client);
  const [version, link, events] = await Promise.all([
    db.from("assessment_versions").select("user_id").eq("id", versionId).maybeSingle(),
    db.from("version_reviews").select("version_id,workspace_id").eq("version_id", versionId).maybeSingle(),
    db.from("review_events").select("*").eq("version_id", versionId).order("id"),
  ]);
  reviewFailure(version.error); reviewFailure(link.error); reviewFailure(events.error);
  if (!version.data) throw new AuthenticationError(404, "Assessment not found.");
  const spaces = await reviewWorkspaces(client, userId);
  return { ownerId: version.data.user_id, workspaceId: link.data?.workspace_id ?? null,
    role: spaces.find((w) => w.id === link.data?.workspace_id)?.role ?? null, events: events.data ?? [] };
}
