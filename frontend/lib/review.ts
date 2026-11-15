export type ReviewRole = "submitter" | "reviewer" | "admin";
export type ReviewStatus = "draft" | "in_review" | "approved" | "rejected" | "changes_requested";
export type ReviewEvent = {
  id: number; version_id: string; assessment_id: string; version: number;
  actor_id: string | null; actor_label: string; occurred_at: string;
  from_status: string | null; to_status: string; comment: string;
  rules_version: string; mapping_version: string;
};
export type ReviewWorkspace = { id: string; name: string; role: ReviewRole };
export type ReviewContext = {
  ownerId: string; workspaceId: string | null; role: ReviewRole | null; events: ReviewEvent[];
};
export function reviewActions(status: ReviewStatus, owner: boolean, role: ReviewRole | null) {
  if (owner) return status === "draft" || status === "changes_requested" ? ["in_review"] as const : [];
  return status === "in_review" && (role === "reviewer" || role === "admin")
    ? ["approved", "changes_requested", "rejected"] as const : [];
}
