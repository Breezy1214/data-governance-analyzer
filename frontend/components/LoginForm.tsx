"use client";

import Link from "next/link";
import { useEffect, type FormEvent } from "react";
import { clearPrivateState, notifyAuthChange } from "@/lib/auth-client";
import { AUTH_MESSAGES } from "@/lib/auth-messages";
import { AuthShell, EmailField, clearPassword, useAuthRequest } from "./AccountForms";

export function LoginForm({ expired = false }: { expired?: boolean }) {
  const { busy, error, send } = useAuthRequest("/api/login", expired ? AUTH_MESSAGES.expired : "");
  useEffect(() => {
    clearPrivateState();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const ok = await send({ email: String(fields.get("email")).trim(), password: String(fields.get("password")) });
    clearPassword(form);
    if (!ok) return;
    notifyAuthChange();
    window.location.replace("/");
  }

  return <AuthShell title="Client sign in">
    <form className="auth-form" onSubmit={submit} aria-busy={busy}>
      <EmailField disabled={busy} autoComplete="username" />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} disabled={busy} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
      <p className="auth-note"><Link href="/signup">Create an account</Link> · <Link href="/forgot-password">Forgot your password?</Link></p>
    </form>
  </AuthShell>;
}
