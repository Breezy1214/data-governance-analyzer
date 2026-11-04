"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AUTH_EVENT, AUTH_TIMEOUT_MS, clearPrivateState, notifyAuthChange } from "@/lib/auth-client";
import type { AppRole } from "@/lib/app-role";

type Account = { id: string; email: string; role: AppRole; disabled: boolean };
type AccountPage = { users: Account[]; page: number; hasMore: boolean };

export function AdminConsole({ actorId }: { actorId: string }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountPage>({ users: [], page: 1, hasMore: false });
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const checkResponse = useCallback(async (response: Response) => {
    if (response.status === 401 || response.status === 403) {
      setLocked(true);
      setAccounts({ users: [], page: 1, hasMore: false });
      if (response.status === 401) { clearPrivateState(); router.replace("/login?reason=expired"); }
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Account management is unavailable.");
    return data;
  }, [router]);

  useEffect(() => {
    if (locked) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/admin/users?page=${page}`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(AUTH_TIMEOUT_MS)]),
        });
        if (controller.signal.aborted) return;
        const result = await checkResponse(response);
        if (!controller.signal.aborted) setAccounts(result);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load accounts.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    const update = () => { if (document.visibilityState !== "hidden") setRefresh((value) => value + 1); };
    const signedOut = (event: StorageEvent) => {
      if (event.key !== AUTH_EVENT) return;
      controller.abort();
      setLocked(true);
      setAccounts({ users: [], page: 1, hasMore: false });
      clearPrivateState();
      router.replace("/login");
    };
    const interval = window.setInterval(update, 60000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("storage", signedOut);
    return () => {
      controller.abort(); clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("storage", signedOut);
    };
  }, [page, refresh, checkResponse, locked, router]);

  async function mutate(url: string, method: string, body: unknown) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        cache: "no-store", signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      });
      await checkResponse(response);
      setNotice(method === "POST" ? "Account created. Share the login details privately." : "Account updated.");
      setRefresh((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The account could not be updated.");
    } finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = { email: data.get("email"), password: data.get("password"), role: data.get("role") };
    // Remove the password from the input as soon as it is submitted, including on failure.
    (form.elements.namedItem("password") as HTMLInputElement).value = "";
    await mutate("/api/admin/users", "POST", body);
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>, user: Account) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = new FormData(form).get("password");
    form.reset();
    if (!window.confirm(`Replace the password for ${user.email}?`)) return;
    await mutate(`/api/admin/users/${user.id}`, "PATCH", { password });
  }

  async function signOut() {
    setLocked(true); setAccounts({ users: [], page: 1, hasMore: false });
    clearPrivateState(); notifyAuthChange(); setError("");
    try {
      const response = await fetch("/api/logout", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) });
      if (!response.ok) throw new Error();
      router.replace("/login");
    } catch { setError("Sign-out could not be confirmed. Please retry before leaving this device."); }
  }

  if (locked) return <main className="auth-page"><h1>Admin access locked</h1>
    {error && <p className="error" role="alert">{error}</p>}
    <p>Sign in with an active administrator account to manage users.</p>
    <button className="secondary" onClick={signOut}>Sign out</button> <Link href="/">Back to assessments</Link></main>;

  return <main className="admin-page">
    <header className="admin-heading"><div><p className="eyebrow">Data Governance Analyzer</p><h1>Account management</h1></div>
      <nav aria-label="Account navigation"><Link href="/">Open assessments</Link><button className="secondary" onClick={signOut}>Sign out</button></nav>
    </header>
    <p>Admins can use every assessment feature and manage all accounts. Assessments stay in the user’s browser; there is no shared assessment history.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <p role="status" aria-live="polite">{notice}</p>
    <section className="card" aria-labelledby="create-heading"><h2 id="create-heading">Create an account</h2>
      <p>Create accounts only for people whose email addresses you have verified. Share each password privately.</p>
      <form className="admin-form" onSubmit={create}>
        <label>Email address<input name="email" type="email" autoComplete="off" required maxLength={254} /></label>
        <label>Initial password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} /></label>
        <label>Account role<select name="role" defaultValue="user"><option value="user">User</option><option value="admin">Admin</option></select></label>
        <button className="primary" type="submit" disabled={busy}>Create account</button>
      </form>
      <p className="auth-note">Use at least 12 characters and meet the team’s password policy. Admin access includes managing other admins.</p>
    </section>
    <section aria-labelledby="accounts-heading"><div className="admin-heading"><h2 id="accounts-heading">Accounts</h2>
      <button className="secondary" disabled={busy || loading} onClick={() => setRefresh((value) => value + 1)}>Refresh accounts</button></div>
      {loading && <p role="status">Loading accounts…</p>}
      {!loading && accounts.users.length === 0 && !error && <p>No accounts on this page.</p>}
      <ul className="admin-accounts">{accounts.users.map((user) => <li className="card" key={user.id}>
        <h3>{user.email || "Account without an email"}{user.id === actorId ? " (you)" : ""}</h3>
        <p>{user.role === "admin" ? "Admin" : "User"} · {user.disabled ? "Disabled" : "Active"}</p>
        {user.id !== actorId && <div className="admin-actions">
          <button className="secondary" disabled={busy || loading} onClick={() => {
            const role = user.role === "admin" ? "user" : "admin";
            if (window.confirm(`Change ${user.email} to ${role}?`)) void mutate(`/api/admin/users/${user.id}`, "PATCH", { role });
          }}>{user.role === "admin" ? "Make user" : "Make admin"}</button>
          <button className="secondary" disabled={busy || loading} onClick={() => {
            if (window.confirm(`${user.disabled ? "Enable" : "Disable"} ${user.email}?`)) void mutate(`/api/admin/users/${user.id}`, "PATCH", { disabled: !user.disabled });
          }}>{user.disabled ? "Enable account" : "Disable account"}</button>
        </div>}
        <form className="admin-password" onSubmit={(event) => resetPassword(event, user)}>
          <label htmlFor={`password-${user.id}`}>New password for {user.email}<input id={`password-${user.id}`} name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} /></label>
          <button className="secondary" disabled={busy || loading}>Set new password</button>
        </form>
      </li>)}</ul>
      <nav className="admin-actions" aria-label="Account pages">
        <button className="secondary" disabled={page <= 1 || busy || loading} onClick={() => setPage((value) => value - 1)}>Previous</button>
        <span>Page {page}</span>
        <button className="secondary" disabled={!accounts.hasMore || busy || loading} onClick={() => setPage((value) => value + 1)}>Next</button>
      </nav>
      <p className="auth-note">Disabling blocks future sign-in and refresh. Already-issued access tokens can last until expiry. You cannot disable yourself or change your own role here.</p>
    </section>
  </main>;
}
