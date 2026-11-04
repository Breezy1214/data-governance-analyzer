"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AUTH_EVENT, AUTH_TIMEOUT_MS, clearPrivateState, notifyAuthChange, type AuthSession } from "@/lib/auth-client";
import { AssessmentWizard } from "./AssessmentWizard";

export function AuthenticatedAssessment({ session }: { session: AuthSession }) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const expire = useCallback(() => {
    clearPrivateState();
    setBlocked(true);
    router.replace("/login?reason=expired");
  }, [router]);

  useEffect(() => {
    if (blocked) return;
    let checking = false;
    const controller = new AbortController();
    const check = async () => {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const response = await fetch("/api/session", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(AUTH_TIMEOUT_MS)]),
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { expire(); return; }
        if (!response.ok) throw new Error("Unavailable");
        const current: AuthSession = await response.json();
        if (current.user.id !== session.user.id) { expire(); return; }
        setError("");
      } catch {
        if (!controller.signal.aborted) setError("Session check unavailable. Your work is still here; we will retry.");
      } finally { checking = false; }
    };
    const storage = (event: StorageEvent) => { if (event.key === AUTH_EVENT) expire(); };
    // No second activity/idle timer: the wizard owns draft retention; Supabase owns login expiry.
    const interval = window.setInterval(check, 60000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("storage", storage);
    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("storage", storage);
    };
  }, [session.user.id, expire, blocked]);

  async function logout() {
    setBlocked(true);
    clearPrivateState();
    notifyAuthChange();
    setError("");
    try {
      const response = await fetch("/api/logout", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) });
      if (!response.ok) throw new Error("Unavailable");
      router.replace("/login");
    } catch {
      setError("Sign-out could not be confirmed. Please retry before leaving this device.");
    }
  }

  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {blocked
      ? <main className="auth-page"><p role="status">Assessment locked.</p>
          <button className="secondary" onClick={logout}>Retry sign out</button></main>
      : <AssessmentWizard draftOwner={session.user.id} onUnauthorized={expire}
          account={<div className="account-controls"><span>{session.user.email}</span>
            {session.user.role === "admin" && <Link href="/admin">Admin</Link>}
            <button className="secondary" onClick={logout}>Sign out</button></div>} />}
  </>;
}
