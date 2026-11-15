import { AUTH_MESSAGES } from "./auth-messages";
import { clearDraft, purgeLegacyDrafts, safely } from "./session";

export type AuthSession = { user: { id: string; email: string } };

export const AUTH_EVENT = "auth-changed";
export const AUTH_TIMEOUT_MS = 15_000;
const OWNER_KEY = "draft-owner";

export function clearPrivateState() {
  clearDraft();
  purgeLegacyDrafts();
  safely(() => sessionStorage.removeItem(OWNER_KEY));
}

export function bindDraft(ownerId: string) {
  const owner = safely(() => sessionStorage.getItem(OWNER_KEY));
  if (owner !== ownerId) clearDraft();
  safely(() => sessionStorage.setItem(OWNER_KEY, ownerId));
}

export async function postAuth(path: string, body: Record<string, string>):
  Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (response.ok) return { ok: true };
    const payload = await response.json().catch(() => null);
    return { ok: false, message: typeof payload?.message === "string" ? payload.message : AUTH_MESSAGES.unavailable };
  } catch {
    return { ok: false, message: AUTH_MESSAGES.offline };
  }
}

export function notifyAuthChange() {
  // Only a random notification is persisted, never identity, credentials or answers.
  safely(() => localStorage.setItem(AUTH_EVENT, crypto.randomUUID()));
}

export const SIGN_OUT_FAILED = "Sign-out could not be confirmed. Please retry before leaving this device.";

/** False when the server didn't confirm the sign-out. */
export async function signOut(): Promise<boolean> {
  clearPrivateState();
  notifyAuthChange();
  try {
    const response = await fetch("/api/logout", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}
