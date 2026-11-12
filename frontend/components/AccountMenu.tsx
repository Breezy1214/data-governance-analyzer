"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SIGN_OUT_FAILED, signOut } from "@/lib/auth-client";

/** The signed-in account and sign-out, for pages outside the assessment wizard. */
export function AccountMenu({ email }: { email: string }) {
  const router = useRouter();
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

  return <div className="account-controls">
    <span>{email}</span>
    <button className="secondary" type="button" disabled={busy} onClick={logout}>{busy ? "Signing out…" : "Sign out"}</button>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
