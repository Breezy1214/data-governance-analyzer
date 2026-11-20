"use client";

import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { deleteAssessment, deleteWarning } from "@/lib/register";
import { ConfirmPanel } from "./ConfirmPanel";
import { Icon } from "./Icons";

/**
 * Deletes an assessment from its register row. The confirmation is a modal dialog, which traps focus,
 * closes on Escape and returns focus to this button.
 */
export function DeleteAssessmentButton({ assessmentId, title, versionCount }: {
  assessmentId: string;
  title: string;
  versionCount: number;
}) {
  const router = useRouter();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function show() {
    setError("");
    setOpen(true);
    dialog.current?.showModal();
  }

  async function remove() {
    setBusy(true);
    setError("");
    const failure = await deleteAssessment(assessmentId);
    if (failure === null) {
      // The button stays busy until the refreshed register drops this row.
      dialog.current?.close();
      router.refresh();
      return;
    }
    // Some browsers drop focus from a button while it is disabled, so put it back on the safe choice.
    flushSync(() => {
      setError(failure);
      setBusy(false);
    });
    dialog.current?.querySelector<HTMLButtonElement>(".confirm-panel button")?.focus();
  }

  return <>
    <button className="row-action" type="button" aria-haspopup="dialog" disabled={busy} onClick={show}>
      <Icon name="trash" size={16} />
      {busy ? "Deleting…" : <>Delete<span className="sr-only"> {title}</span></>}
    </button>
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby={`${id}-title`}
      onClose={() => setOpen(false)} onCancel={(event) => { if (busy) event.preventDefault(); }}>
      {open && (
        <ConfirmPanel id={id} title="Delete this assessment?" cancelLabel="Keep it"
          confirmLabel={busy ? "Deleting…" : "Delete permanently"} busy={busy}
          onCancel={() => dialog.current?.close()} onConfirm={remove}>
          <b>{title}</b><br />{deleteWarning(versionCount)}
        </ConfirmPanel>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </dialog>
  </>;
}
