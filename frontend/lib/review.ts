import { ASSESSMENT_TIMEOUT_MS } from "./assessment";
import type { AssessmentStatus } from "./register";

export const ROLE_LABELS = { submitter: "Submitter", reviewer: "Reviewer", admin: "Admin" } as const;
export type ReviewRole = keyof typeof ROLE_LABELS;
export const ROLE_DESCRIPTIONS: Record<ReviewRole, string> = {
  submitter: "Submits their own assessments for review.",
  reviewer: "Also approves, rejects or requests changes on teammates’ submissions.",
  admin: "Also adds members and changes their roles.",
};
export type ReviewEvent = {
  id: number; assessment_id: string; version: number;
  /** Null for the snapshot recorded when the workflow was installed. */
  actor_id: string | null;
  /** The actor's account email, resolved when read; falls back to the stored label. */
  actor_name: string;
  occurred_at: string;
  from_status: AssessmentStatus | null; to_status: AssessmentStatus; comment: string;
  rules_version: string; mapping_version: string;
};
export type ReviewWorkspace = {
  id: string; name: string; role: ReviewRole;
  /** Other members who can decide the viewer's submissions. */
  reviewers: number;
};
export type ReviewContext = {
  workspaceId: string | null; role: ReviewRole | null; events: ReviewEvent[];
};
export type ReviewDecision = Exclude<AssessmentStatus, "draft">;

export const DECISION_LABELS: Record<ReviewDecision, string> = {
  in_review: "Submit for review", approved: "Approve", rejected: "Reject", changes_requested: "Request changes",
};

/** How each status change reads in a version's history. */
export const EVENT_LABELS: Record<AssessmentStatus, string> = {
  draft: "Saved as draft", in_review: "Submitted for review", approved: "Approved", rejected: "Rejected",
  changes_requested: "Changes requested",
};

/**
 * What the viewer may do next. A version put in review before workspaces existed has no workspace yet,
 * so its owner submits it to one as if it were a draft.
 */
export function reviewActions(status: AssessmentStatus, owner: boolean, role: ReviewRole | null, workspaceId: string | null) {
  if (owner) {
    const submittable = status === "draft" || status === "changes_requested" || (status === "in_review" && !workspaceId);
    return submittable ? ["in_review"] as const : [];
  }
  return status === "in_review" && (role === "reviewer" || role === "admin")
    ? ["approved", "changes_requested", "rejected"] as const : [];
}

export function approvalSignOff(status: AssessmentStatus, events: ReviewEvent[]) {
  return status === "approved" ? events.findLast((event) => event.to_status === "approved") : undefined;
}

const REVIEW_FAILED = "The change couldn't be saved. Please try again.";

/** Resolves to null once saved, otherwise to the message to show. */
export async function postReview(body: object): Promise<string | null> {
  const response = await fetch("/api/reviews", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    cache: "no-store", signal: AbortSignal.timeout(ASSESSMENT_TIMEOUT_MS),
  }).catch(() => null);
  if (response?.ok) return null;
  const data = await response?.json().catch(() => null);
  return typeof data?.message === "string" ? data.message : REVIEW_FAILED;
}
