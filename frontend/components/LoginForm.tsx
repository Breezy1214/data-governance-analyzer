"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AUTH_TIMEOUT_MS, clearPrivateState, notifyAuthChange } from "@/lib/auth-client";
import { AUTH_MESSAGES } from "@/lib/auth-messages";

export function LoginForm({ expired = false }: { expired?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(expired ? AUTH_MESSAGES.expired : "");
  useEffect(() => {
    clearPrivateState();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(fields.get("email")).trim(), password: String(fields.get("password")) }),
        cache: "no-store",
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(typeof payload?.message === "string" ? payload.message : AUTH_MESSAGES.unavailable);
        return;
      }
      notifyAuthChange();
      window.location.replace("/");
    } catch {
      setError(AUTH_MESSAGES.offline);
    } finally {
      const password = form.elements.namedItem("password");
      if (password instanceof HTMLInputElement) password.value = "";
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <header className="auth-heading"><h1>Client sign in</h1>
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
