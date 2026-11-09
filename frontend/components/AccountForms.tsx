"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { clearPrivateState, notifyAuthChange, postAuth } from "@/lib/auth-client";
import { AUTH_MESSAGES } from "@/lib/auth-messages";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_CHARACTERS } from "@/lib/password-policy";

const BACK_TO_SIGN_IN = <p className="auth-note"><Link href="/login">Back to sign in</Link></p>;

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return <main className="auth-page">
    <header className="auth-heading"><h1>{title}</h1>
      <p>Data Governance Readiness Analyzer</p></header>
    {children}
  </main>;
}

export function useAuthRequest(path: string, initialError = "") {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  async function send(body: Record<string, string>) {
    if (busy) return false;
    setBusy(true);
    setError("");
    const result = await postAuth(path, body);
    setBusy(false);
    if (!result.ok) setError(result.message);
    return result.ok;
  }

  return { busy, error, send };
}

export function clearPassword(form: HTMLFormElement) {
  const password = form.elements.namedItem("password");
  if (password instanceof HTMLInputElement) password.value = "";
}

export function EmailField({ disabled, autoComplete = "email" }: { disabled: boolean; autoComplete?: string }) {
  return <>
    <label htmlFor="email">Email address</label>
    <input id="email" name="email" type="email" autoComplete={autoComplete} required maxLength={254} disabled={disabled} />
  </>;
}

function NewPasswordField({ label, disabled }: { label: string; disabled: boolean }) {
  const [visible, setVisible] = useState(false);
  return <>
    <label htmlFor="password">{label}</label>
    <input id="password" name="password" type={visible ? "text" : "password"} autoComplete="new-password" required
      minLength={PASSWORD_MIN_CHARACTERS} maxLength={PASSWORD_MAX_BYTES} aria-describedby="password-hint" disabled={disabled} />
    <p id="password-hint" className="auth-note">{AUTH_MESSAGES.passwordRules}</p>
    <label className="auth-toggle">
      <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} /> Show password
    </label>
  </>;
}

function CheckYourEmail({ children }: { children: ReactNode }) {
  return <AuthShell title="Check your email">
    <p className="auth-message" role="status">{children}</p>
    {BACK_TO_SIGN_IN}
  </AuthShell>;
}

export function SignupForm() {
  const { busy, error, send } = useAuthRequest("/api/signup");
  const [sentTo, setSentTo] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = String(fields.get("email")).trim();
    const ok = await send({ email, password: String(fields.get("password")) });
    clearPassword(form);
    if (ok) setSentTo(email);
  }

  if (sentTo) {
    return <CheckYourEmail>
      A link to activate your account has been sent to {sentTo}. If it doesn&apos;t arrive within a few minutes,
      check your spam folder or sign up again. If you already have an account, you can sign in.
    </CheckYourEmail>;
  }
  return <AuthShell title="Create an account">
    <form className="auth-form" onSubmit={submit} aria-busy={busy}>
      <EmailField disabled={busy} />
      <NewPasswordField label="Password" disabled={busy} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? "Creating account..." : "Create account"}</button>
      <p className="auth-note">Already have an account? <Link href="/login">Sign in</Link></p>
    </form>
  </AuthShell>;
}

export function ForgotPasswordForm({ expired = false }: { expired?: boolean }) {
  const { busy, error, send } = useAuthRequest("/api/forgot-password", expired ? AUTH_MESSAGES.linkInvalid : "");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await send({ email: String(new FormData(event.currentTarget).get("email")) })) setSent(true);
  }

  if (sent) {
    return <CheckYourEmail>
      If an account exists for that address, a link to reset the password has been sent.
    </CheckYourEmail>;
  }
  return <AuthShell title="Reset your password">
    <form className="auth-form" onSubmit={submit} aria-busy={busy}>
      <EmailField disabled={busy} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? "Sending..." : "Send reset link"}</button>
      {BACK_TO_SIGN_IN}
    </form>
  </AuthShell>;
}

export function ConfirmLinkForm({ tokenHash, type }: { tokenHash: string; type: "email" | "recovery" }) {
  const { busy, error, send } = useAuthRequest("/api/confirm", tokenHash ? "" : AUTH_MESSAGES.linkInvalid);
  const recovery = type === "recovery";

  async function confirm() {
    if (!await send({ tokenHash, type })) return;
    clearPrivateState();
    notifyAuthChange();
    window.location.replace(recovery ? "/update-password" : "/");
  }

  return <AuthShell title={recovery ? "Reset your password" : "Confirm your email"}>
    <div className="auth-form" aria-busy={busy}>
      {error && <p className="error" role="alert">{error}</p>}
      {tokenHash && <button className="primary" type="button" disabled={busy} onClick={confirm}>
        {busy ? "Checking..." : recovery ? "Continue" : "Confirm email"}
      </button>}
      {BACK_TO_SIGN_IN}
    </div>
  </AuthShell>;
}

export function UpdatePasswordForm() {
  const { busy, error, send } = useAuthRequest("/api/update-password");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const ok = await send({ password: String(new FormData(form).get("password")) });
    clearPassword(form);
    if (ok) window.location.replace("/");
  }

  return <AuthShell title="Choose a new password">
    <form className="auth-form" onSubmit={submit} aria-busy={busy}>
      <NewPasswordField label="New password" disabled={busy} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? "Saving..." : "Save password"}</button>
    </form>
  </AuthShell>;
}
