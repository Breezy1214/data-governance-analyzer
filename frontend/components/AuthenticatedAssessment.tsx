"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthSession } from "@/lib/auth-messages";
import { AUTH_EVENT, clearPrivateState, notifyAuthChange } from "@/lib/auth-client";
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
    let alive = true;
    let checking = false;
    const controller = new AbortController();
    const check = async () => {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const response = await fetch("/api/session", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!alive) return;
        if (response.status === 401) { expire(); return; }
        if (!response.ok) throw new Error("Unavailable");
        const current: AuthSession = await response.json();
        if (current.binding !== session.binding) { expire(); return; }
        setError("");
      } catch {
        if (alive) setError("Session check unavailable. Your work is still here; we will retry.");
      } finally { checking = false; }
    };
    const storage = (event: StorageEvent) => { if (event.key === AUTH_EVENT) expire(); };
    // No second activity/idle timer: the wizard owns draft retention; Supabase owns login expiry.
    const interval = window.setInterval(check, 60000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("storage", storage);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("storage", storage);
    };
  }, [session.binding, expire, blocked]);

  async function logout() {
    setBlocked(true);
    clearPrivateState();
    notifyAuthChange();
    setError("");
    try {
      const response = await fetch("/api/logout", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Unavailable");
      router.replace("/login?reason=signed-out");
    } catch {
      setError("Sign-out could not be confirmed. Please retry before leaving this device.");
    }
  }

  return <>
    {error && <p className="auth-status" role="alert">{error}</p>}
    {blocked
      ? <main className="auth-page"><p role="status">Assessment locked.</p>
          <button className="secondary" onClick={logout}>Retry sign out</button></main>
      : <AssessmentWizard sessionBinding={session.binding} onUnauthorized={expire}
          account={<div className="account-controls"><span>{session.user.email}</span>
            <button className="secondary" onClick={logout}>Sign out</button></div>} />}
  </>;
}
