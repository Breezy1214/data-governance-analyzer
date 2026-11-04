import { clearDraft, purgeLegacyDrafts, safely } from "./session";

export type AuthSession = { user: { id: string; email: string; role?: "user" | "admin" } };

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

export function notifyAuthChange() {
  // Only a random notification is persisted, never identity, credentials or answers.
  safely(() => localStorage.setItem(AUTH_EVENT, crypto.randomUUID()));
}
