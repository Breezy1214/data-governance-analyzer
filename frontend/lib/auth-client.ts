import { clearDraft, purgeLegacyDrafts } from "./session";

export const AUTH_EVENT = "karlsgate-auth-changed";
const OWNER_KEY = "karlsgate-draft-owner";

export function clearPrivateState() {
  clearDraft();
  purgeLegacyDrafts();
  try { sessionStorage.removeItem(OWNER_KEY); } catch { /* Storage can be blocked. */ }
}

export function bindDraft(binding: string) {
  try {
    if (sessionStorage.getItem(OWNER_KEY) !== binding) clearDraft();
    sessionStorage.setItem(OWNER_KEY, binding);
  } catch { clearDraft(); }
}

export function notifyAuthChange() {
  // Only a random notification is persisted, never identity, credentials or answers.
  try { localStorage.setItem(AUTH_EVENT, crypto.randomUUID()); } catch { /* Best effort across tabs. */ }
}
