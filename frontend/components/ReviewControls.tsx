"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LocalTime } from "./LocalTime";
import { type AssessmentStatus, STATUS_LABELS } from "@/lib/register";
import {
  DECISION_LABELS, EVENT_LABELS, type ReviewContext, type ReviewDecision, type ReviewEvent, type ReviewWorkspace,
  postReview, reviewActions,
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
  const [picked, setPicked] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<ReviewDecision | null>(null);
  const actions = reviewActions(status, isOwner, context.role, context.workspaceId);
  const needsWorkspace = isOwner && actions.length > 0 && workspaces.length === 0 && !context.workspaceId;
  const latest = context.events.at(-1);
  const only = !context.workspaceId && workspaces.length === 1 ? workspaces[0] : undefined;
  const workspace = context.workspaceId ?? only?.id ?? picked;
  const chosen = isOwner ? workspaces.find((entry) => entry.id === workspace) : undefined;
  const label = (action: ReviewDecision) => action === "in_review" && only ? `Submit to ${only.name}` : DECISION_LABELS[action];

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
      <div className="review-head">
        <h3 className="card-title" id={`${id}-heading`}>Review</h3>
        <span className="badge badge-neutral">{STATUS_LABELS[status]}</span>
      </div>
      <StatusLine status={status} isOwner={isOwner} latest={latest} workspace={context.workspaceId ? chosen : undefined} />
      {actions.length > 0 && chosen?.reviewers === 0 && <NoReviewer name={chosen.name} />}
      {needsWorkspace ? (
        <p>Join a workspace to submit this for review. <Link href="/reviews">Workspace reviews</Link></p>
      ) : actions.length > 0 && <>
        {isOwner && !context.workspaceId && !only && (
          <label className="select-field" htmlFor={`${id}-workspace`}>
            <span>Workspace</span>
            <select id={`${id}-workspace`} value={picked} disabled={pending !== null} onChange={(event) => setPicked(event.target.value)}>
              <option value="">Choose a workspace</option>
              {workspaces.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-field" htmlFor={`${id}-note`}>
          <span>{isOwner ? "Note for the reviewer" : "Comment"} {!isOwner && <b className="badge">Required</b>}</span>
          <textarea id={`${id}-note`} value={note} maxLength={2000} disabled={pending !== null}
            placeholder="Kept in the history. Leave out personal data." onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="actions wrap">
          {actions.map((action) => (
            <button type="button" className={action === "in_review" || action === "approved" ? "primary" : "secondary"} key={action} aria-busy={pending === action}
              disabled={pending !== null || (action === "in_review" ? !workspace : !note.trim())} onClick={() => decide(action)}>
              {pending === action ? "Saving…" : label(action)}
            </button>
          ))}
        </div>
      </>}
      {error && <p role="alert" className="error">{error}</p>}
      {latest && (
        <details className="disclosure">
          <summary>History ({context.events.length})</summary>
          <ol className="review-history">
            {context.events.map((event) => (
              <li key={event.id}>
                <p><strong>{EVENT_LABELS[event.to_status]}</strong> · {event.actor_name} · <LocalTime value={event.occurred_at} /></p>
                {event.comment && <p className="review-comment">{event.comment}</p>}
              </li>
            ))}
          </ol>
          <p className="method-note">Scored with rubric {latest.rules_version} and catalog {latest.mapping_version}.</p>
        </details>
      )}
    </section>
  );
}

function StatusLine({ status, isOwner, latest, workspace }: {
  status: AssessmentStatus; isOwner: boolean; latest: ReviewEvent | undefined; workspace: ReviewWorkspace | undefined;
}) {
  if (!latest || status === "draft") return null;
  const when = <LocalTime value={latest.occurred_at} />;
  if (status === "in_review" && isOwner) {
    // An owner's version with no workspace predates workspaces and is still waiting to be sent to one.
    if (!workspace) return null;
    return workspace.reviewers === 0 ? <NoReviewer name={workspace.name} />
      : <p className="method-note">Waiting for a reviewer in {workspace.name}.</p>;
  }
  if (status === "in_review") return <p className="method-note">Submitted by {latest.actor_name} · {when}</p>;
  return <>
    <p className="method-note">{EVENT_LABELS[status]} by {latest.actor_name} · {when}</p>
    {latest.comment && <p className="review-comment">{latest.comment}</p>}
  </>;
}

/** A workspace where only the author can decide would leave the submission waiting forever. */
function NoReviewer({ name }: { name: string }) {
  return <p className="warning-note">No one else in {name} can review this yet. <Link href="/reviews">Add a reviewer</Link></p>;
}
