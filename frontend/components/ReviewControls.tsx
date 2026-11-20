"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { LocalTime } from "./LocalTime";
import { type AssessmentStatus, STATUS_LABELS } from "@/lib/register";
import {
  DECISION_LABELS, type ReviewContext, type ReviewDecision, type ReviewWorkspace, postReview, reviewActions,
} from "@/lib/review";

export function ReviewControls({ versionId, status, context, isOwner, workspaces }: {
  versionId: string;
  status: AssessmentStatus;
  context: ReviewContext;
  isOwner: boolean;
  workspaces: ReviewWorkspace[];
}) {
  const router = useRouter();
  const id = useId();
  const [workspace, setWorkspace] = useState(context.workspaceId ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<ReviewDecision | null>(null);
  const actions = reviewActions(status, isOwner, context.role, context.workspaceId);

  async function decide(next: ReviewDecision) {
    setPending(next);
    setError("");
    const failure = await postReview({
      action: "transition", versionId, workspaceId: workspace || null, note, status: next, expectedStatus: status,
    });
    setPending(null);
    if (failure) {
      setError(failure);
      return;
    }
    setNote("");
    router.refresh();
  }

  return (
    <section className="card review-panel" aria-labelledby={`${id}-heading`}>
      <h3 className="card-title" id={`${id}-heading`}>Review and approval</h3>
      <p className="method-note">Decisions apply only to this saved version. You can’t review your own submission.</p>
      {actions.length > 0 && <>
        {isOwner && (
          <label className="select-field" htmlFor={`${id}-workspace`}>
            <span>Workspace</span>
            <select id={`${id}-workspace`} value={workspace} disabled={pending !== null || Boolean(context.workspaceId)}
              onChange={(event) => setWorkspace(event.target.value)}>
              <option value="">Choose a workspace</option>
              {workspaces.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-field" htmlFor={`${id}-note`}>
          <span>Comment {!isOwner && <b className="badge">Required</b>}</span>
          <textarea id={`${id}-note`} value={note} maxLength={2000} disabled={pending !== null}
            onChange={(event) => setNote(event.target.value)} />
        </label>
        <p className="method-note">Avoid personal or sensitive information. Submitted comments become part of the permanent audit record.</p>
        <div className="actions wrap">
          {actions.map((action) => (
            <button type="button" className="secondary" key={action} aria-busy={pending === action}
              disabled={pending !== null || (action === "in_review" ? !workspace : !note.trim())} onClick={() => decide(action)}>
              {pending === action ? "Saving…" : DECISION_LABELS[action]}
            </button>
          ))}
        </div>
      </>}
      {error && <p role="alert" className="error">{error}</p>}
      <h4>Audit history</h4>
      <ol className="review-history">
        {context.events.map((event) => (
          <li key={event.id}>
            <p>
              <strong>{event.from_status ? STATUS_LABELS[event.from_status] : "Saved as"} → {STATUS_LABELS[event.to_status]}</strong><br />
              {event.actor_name} · <LocalTime value={event.occurred_at} /> · Rubric {event.rules_version} · Catalog {event.mapping_version}
            </p>
            {event.comment && <p>{event.comment}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
