"use client";

/**
 * An inline "are you sure?" for a destructive action. Focus starts on the safe choice, and Escape cancels.
 * Callers return focus to the trigger in `onCancel`, using flushSync if the trigger is hidden while this is open.
 */
export function ConfirmPanel({
  id, title, children, cancelLabel, confirmLabel, onCancel, onConfirm, busy = false,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className="card confirm-panel"
      id={id}
      role="group"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-detail`}
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) onCancel(); }}
    >
      <h3 className="card-title" id={`${id}-title`}>{title}</h3>
      <p id={`${id}-detail`}>{children}</p>
      <div className="actions end">
        <button autoFocus className="secondary" type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        <button className="destructive" type="button" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}
