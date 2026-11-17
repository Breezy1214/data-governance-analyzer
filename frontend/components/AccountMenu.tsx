"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { SIGN_OUT_FAILED, signOut } from "@/lib/auth-client";
import { Icon } from "./Icons";

/**
 * The signed-in account as a disclosure: the native popover gives Esc, outside-click
 * dismissal and focus return. Pass onSignOut to replace the default sign-out.
 */
export function AccountMenu({ email, onSignOut }: { email: string; onSignOut?: () => void }) {
  const router = useRouter();
  const panel = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setBusy(true);
    setError("");
    if (await signOut()) router.replace("/login");
    else {
      setError(SIGN_OUT_FAILED);
      setBusy(false);
    }
  }

  return <div className="account-menu">
    <button className="account-trigger" type="button" popoverTarget={panel} aria-controls={panel}
      aria-expanded={open} aria-label={`Account, ${email}`}>
      <span className="avatar" aria-hidden="true">{email.charAt(0)}</span>
      <span className="account-email">{email}</span>
      <Icon name="chevron" size={14} />
    </button>
    <div className="account-panel" id={panel} popover="auto" onToggle={(event) => setOpen(event.newState === "open")}>
      <p className="account-who">Signed in as <b>{email}</b></p>
      <button className="secondary" type="button" disabled={busy} onClick={onSignOut ?? logout}>{busy ? "Signing out…" : "Sign out"}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </div>;
}
