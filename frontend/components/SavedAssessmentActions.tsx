"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import type { AssessmentInput, AssessmentResult } from "@/lib/assessment";
import { downloadAssessmentReport } from "@/lib/report";
import { DESCRIPTION_NOT_SAVED, REGISTER_PATH, deleteAssessment, deleteWarning } from "@/lib/register";
import { ConfirmPanel } from "@/components/ConfirmPanel";
import type { SimulatedPlan } from "@/lib/simulation";
import type { ReviewEvent } from "@/lib/review";

export type SavedAssessmentActionsProps = {
  assessmentId: string;
  input: AssessmentInput;
  result: AssessmentResult;
  reassessHref: string;
  duplicateHref: string;
  versionCount: number;
  deletable: boolean;
  /** The what-if plan to add to the report, kept apart from the saved result. */
  simulated?: SimulatedPlan | null;
  isOwner: boolean;
  signOff?: ReviewEvent;
};

export function SavedAssessmentActions({
  assessmentId, input, result, reassessHref, duplicateHref, versionCount, deletable, simulated = null, isOwner, signOff,
}: SavedAssessmentActionsProps) {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const deleteButton = useRef<HTMLButtonElement>(null);

  async function download() {
    setDownloading(true);
    setError("");
    try {
      await downloadAssessmentReport({ ...input, description: DESCRIPTION_NOT_SAVED }, result, simulated, undefined, signOff);
    } catch {
      setError("The report could not be generated. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setError("");
    const failure = await deleteAssessment(assessmentId);
    if (failure === null) {
      router.replace(REGISTER_PATH);
      router.refresh();
      return;
    }
    setError(failure);
    setDeleting(false);
    cancelDelete();
  }

  // The Delete button is hidden while the prompt is open, so render it before returning focus.
  const cancelDelete = () => {
    flushSync(() => setConfirming(false));
    deleteButton.current?.focus();
  };

  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {confirming ? (
      <ConfirmPanel
        id="confirm-delete"
        title="Delete this assessment?"
        cancelLabel="Keep it"
        confirmLabel={deleting ? "Deleting…" : "Delete permanently"}
        onCancel={cancelDelete}
        onConfirm={remove}
        busy={deleting}
      >
        {deleteWarning(versionCount)}
      </ConfirmPanel>
    ) : (
      <div className="actions wrap">
        <div>
          {isOwner && <Link className="secondary" href={duplicateHref}>Duplicate</Link>}
          {isOwner && (deletable
            ? <button ref={deleteButton} className="destructive" type="button" onClick={() => setConfirming(true)}>Delete</button>
            : <span className="method-note">Submitted assessments are retained and can’t be deleted.</span>)}
        </div>
        <div>
          <button className="secondary" type="button" disabled={downloading} aria-busy={downloading} onClick={download}>
            {downloading ? "Preparing report…" : "Download report (PDF) ↓"}
          </button>
          {isOwner && <Link className="primary" href={reassessHref}>Re-assess <span>→</span></Link>}
        </div>
      </div>
    )}
  </>;
}
