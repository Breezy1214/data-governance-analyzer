"use client";

import { useEffect, useState } from "react";
import type { AuthSession } from "@/lib/auth-server";
import { AUTH_EVENT, bindDraft, clearPrivateState, notifyAuthChange } from "@/lib/auth-client";
import { AssessmentWizard } from "./AssessmentWizard";

export function AuthenticatedAssessment({ session }: { session: AuthSession }) {
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    let busy = false;
    let lastActivity = 0;
    let deadline = Math.min(session.expiresAt, session.idleExpiresAt) * 1000;
    const controller = new AbortController();
    const expire = () => {
      if (!alive) return;
      clearPrivateState(); setReady(false);
      window.location.replace("/login?reason=expired");
    };
    const check = async (touch = false) => {
      if (!alive || busy) return;
      busy = true;
      try {
        const response = await fetch(touch ? "/api/activity" : "/api/session", {
          method: touch ? "POST" : "GET", cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!alive) return;
        if (response.status === 401) { expire(); return; }
        if (!response.ok) throw new Error("Unavailable");
        const current: AuthSession = await response.json();
        if (current.binding !== session.binding || current.user.id !== session.user.id) { expire(); return; }
        deadline = Math.min(current.expiresAt, current.idleExpiresAt) * 1000;
        if (Date.now() >= deadline) { expire(); return; }
        bindDraft(session.binding);
        setError(""); setReady(true);
      } catch {
        if (alive) { setReady(false); setError("Unable to verify your session. Retrying..."); }
      } finally { busy = false; }
    };
    const activity = () => {
      if (Date.now() - lastActivity < 60000 || document.visibilityState === "hidden") return;
      lastActivity = Date.now(); void check(true);
    };
    const visibility = () => {
      setReady(false);
      if (document.visibilityState === "visible") void check();
    };
    const storage = (event: StorageEvent) => { if (event.key === AUTH_EVENT) expire(); };
    window.addEventListener("storage", storage);
    window.addEventListener("karlsgate-auth-expired", expire);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", visibility);
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    void check();
    const timer = window.setInterval(() => {
      if (Date.now() >= deadline) expire();
    }, 1000);
    const poll = window.setInterval(() => { if (document.visibilityState !== "hidden") void check(); }, 30000);
    return () => {
      alive = false; controller.abort(); clearInterval(timer); clearInterval(poll);
      events.forEach((event) => window.removeEventListener(event, activity));
      window.removeEventListener("storage", storage); window.removeEventListener("karlsgate-auth-expired", expire);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pageshow", visibility);
    };
  }, [session.binding, session.user.id, session.expiresAt, session.idleExpiresAt]);

  async function logout() {
    setBlocked(true); clearPrivateState(); notifyAuthChange(); setError("");
    try {
      const response = await fetch("/api/logout", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok && response.status !== 401) throw new Error("Unavailable");
      window.location.replace("/login?reason=signed-out");
    } catch { setError("Your work is hidden, but sign-out could not be confirmed. Please retry before leaving this device."); }
  }

  return <>
    <div className="account-bar"><span>{session.user.email}</span>
      <button className="secondary" onClick={logout}>{blocked ? "Retry sign out" : "Sign out"}</button></div>
    {error && <p className="auth-status" role="alert">{error}</p>}
    {ready && !blocked ? <AssessmentWizard /> : <p className="auth-status" role="status">{blocked ? "Assessment locked." : "Checking your session..."}</p>}
  </>;
}
