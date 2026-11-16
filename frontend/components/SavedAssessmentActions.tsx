"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ASSESSMENT_TIMEOUT_MS, type AssessmentInput, type AssessmentResult } from "@/lib/assessment";
import { downloadAssessmentReport } from "@/lib/report";
import { DESCRIPTION_NOT_SAVED, REGISTER_PATH } from "@/lib/register";

const DELETE_FAILED = "The assessment couldn't be deleted. Please try again.";

export function SavedAssessmentActions({
  assessmentId, input, result, reassessHref, duplicateHref, versionCount, deletable,
}: {
  assessmentId: string;
  input: AssessmentInput;
  result: AssessmentResult;
  reassessHref: string;
  duplicateHref: string;
  versionCount: number;
  deletable: boolean;
}) {
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
      await downloadAssessmentReport({ ...input, description: DESCRIPTION_NOT_SAVED }, result);
    } catch {
      setError("The report could not be generated. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setError("");
    const response = await fetch(`/api/assessments/${assessmentId}`, {
      method: "DELETE", cache: "no-store", signal: AbortSignal.timeout(ASSESSMENT_TIMEOUT_MS),
    }).catch(() => null);
    if (response?.ok) {
      router.replace(REGISTER_PATH);
      router.refresh();
      return;
    }
    const body = await response?.json().catch(() => null);
    setError(typeof body?.message === "string" ? body.message : DELETE_FAILED);
    setDeleting(false);
    setConfirming(false);
  }

  const versions = versionCount === 1 ? "its only version" : `all ${versionCount} versions`;
  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {confirming ? (
      <div className="card confirm-delete" role="group" aria-labelledby="confirm-delete-heading">
        <h3 className="card-title" id="confirm-delete-heading">Delete this assessment?</h3>
        <p className="lede">This permanently deletes {versions}. It can’t be undone.</p>
        <div className="actions">
          <button className="secondary" type="button" disabled={deleting}
            onClick={() => { setConfirming(false); deleteButton.current?.focus(); }}>Keep it</button>
          <button className="destructive" type="button" disabled={deleting} onClick={remove}>
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    ) : (
      <div className="actions wrap">
        <div>
          <Link className="secondary" href={duplicateHref}>Duplicate</Link>
          {deletable
            ? <button ref={deleteButton} className="destructive" type="button" onClick={() => setConfirming(true)}>Delete</button>
            : <span className="method-note">Assessments with a version in review or approved can’t be deleted.</span>}
        </div>
        <div>
          <button className="secondary" type="button" disabled={downloading} onClick={download}>
            {downloading ? "Preparing report…" : "Download report (PDF) ↓"}
          </button>
          <Link className="primary" href={reassessHref}>Re-assess <span>→</span></Link>
        </div>
      </div>
    )}
  </>;
}
