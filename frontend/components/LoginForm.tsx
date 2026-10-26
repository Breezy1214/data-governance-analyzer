"use client";

import { useEffect, useState, type FormEvent } from "react";
import { clearPrivateState, notifyAuthChange } from "@/lib/auth-client";

export function LoginForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    clearPrivateState();
    const reason = new URLSearchParams(window.location.search).get("reason");
    const timer = window.setTimeout(() => {
      if (reason === "expired") setError("Your session has ended. Please sign in again.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(fields.get("email")).trim(), password: String(fields.get("password")) }),
        cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        setError(response.status === 401 ? "Email or password is incorrect."
          : response.status === 429 ? "Too many attempts. Please try again later."
          : response.status === 503 ? "Sign-in is not available right now. Please contact your project administrator."
          : "Please check your details and try again.");
        return;
      }
      clearPrivateState(); notifyAuthChange();
      window.location.replace("/");
    } catch { setError("Unable to connect. Please try again."); }
    finally {
      const password = form.elements.namedItem("password");
      if (password instanceof HTMLInputElement) password.value = "";
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <header className="auth-heading"><p className="section-number">KARLSGATE</p><h1>Client sign in</h1>
      <p>Data Governance Readiness Analyzer</p></header>
    <form className="auth-form" onSubmit={submit} aria-busy={busy}>
      <label htmlFor="email">Email address</label>
      <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} disabled={busy} />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} disabled={busy} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
      <p className="auth-note">Need an account or password reset? Contact your project administrator.</p>
    </form>
  </main>;
}
