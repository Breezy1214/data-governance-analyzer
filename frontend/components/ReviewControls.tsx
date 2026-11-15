"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewActions, type ReviewContext, type ReviewStatus, type ReviewWorkspace } from "@/lib/review";

export async function postReview(body: object) {
  const response = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message ?? "The change could not be saved. Please try again.");
  }
}
const LABELS = { in_review: "Submit for review", approved: "Approve", rejected: "Reject", changes_requested: "Request changes" };
export function ReviewControls({ versionId, status, context, userId, workspaces }: {
  versionId: string; status: ReviewStatus; context: ReviewContext; userId: string; workspaces: ReviewWorkspace[];
}) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState(context.workspaceId ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const actions = reviewActions(status === "in_review" && !context.workspaceId ? "draft" : status, context.ownerId === userId, context.role);
  async function decide(next: string) {
    setBusy(true); setError("");
    try {
      await postReview({ action: "transition", versionId, workspaceId: workspace || null, note, status: next, expectedStatus: status });
      setNote(""); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Review unavailable."); }
    finally { setBusy(false); }
  }
  return <section className="card review-panel" aria-labelledby="review-heading">
    <h3 id="review-heading">Review and approval</h3>
    <p>Decisions apply only to this saved version. You cannot review your own submission.</p>
    {actions.length > 0 && <>
      {context.ownerId === userId && <label className="text-field">Workspace
        <select value={workspace} disabled={busy || Boolean(context.workspaceId)} onChange={(e) => setWorkspace(e.target.value)}>
          <option value="">Choose a workspace</option>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </label>}
      <label className="text-field">Comment {context.ownerId !== userId && "(required)"}
        <textarea value={note} maxLength={2000} disabled={busy} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="method-note">Avoid personal or sensitive information. Submitted comments become part of the permanent audit record.</p>
      <div className="actions wrap">{actions.map((action) => <button type="button" className="secondary" key={action}
        disabled={busy || (action === "in_review" ? !workspace : !note.trim())} onClick={() => decide(action)}>{busy ? "Saving…" : LABELS[action]}</button>)}</div>
    </>}
    {error && <p role="alert" className="error">{error}</p>}
    <h4>Audit history</h4>
    <ol>{context.events.map((event) => <li key={event.id}>
      <p><strong>{event.from_status ?? "Initial status"} → {event.to_status}</strong><br />
        {event.actor_label} · {event.occurred_at} · Rubric {event.rules_version} · Catalog {event.mapping_version}</p>
      {event.comment && <p>{event.comment}</p>}
    </li>)}</ol>
  </section>;
}
