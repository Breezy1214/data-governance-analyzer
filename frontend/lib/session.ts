import { AssessmentInput, isAssessmentInput } from "./assessment";

/** v1.0 retains nothing: the draft lives in this tab's sessionStorage and is cleared on tab close, idle timeout or start-over (SCRUM-16, docs/data-handling.md). */

export const DRAFT_KEY = "governance-assessment-draft-v2";
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Earlier builds kept drafts in localStorage with no expiry.
const LEGACY_KEYS = ["governance-assessment-draft-v1"];

type StoredDraft = { savedAt: number; input: AssessmentInput };

function safely<T>(action: () => T, fallback?: T): T | undefined {
  try {
    return action();
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
    return fallback;
  }
}

export function purgeLegacyDrafts(storage?: Storage): void {
  safely(() => {
    const target = storage ?? window.localStorage;
    LEGACY_KEYS.forEach((key) => target.removeItem(key));
  });
}

export function saveDraft(input: AssessmentInput, storage?: Storage, now = Date.now()): void {
  const draft: StoredDraft = { savedAt: now, input };
  safely(() => (storage ?? window.sessionStorage).setItem(DRAFT_KEY, JSON.stringify(draft)));
}

export function loadDraft(storage?: Storage, now = Date.now()): AssessmentInput | null {
  const raw = safely(() => (storage ?? window.sessionStorage).getItem(DRAFT_KEY), null);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as StoredDraft;
    if (!draft || !Number.isFinite(draft.savedAt) || draft.savedAt > now
      || now - draft.savedAt >= IDLE_TIMEOUT_MS || !isAssessmentInput(draft.input)) {
      clearDraft(storage);
      return null;
    }
    return draft.input;
  } catch {
    clearDraft(storage);
    return null;
  }
}

export function clearDraft(storage?: Storage): void {
  safely(() => (storage ?? window.sessionStorage).removeItem(DRAFT_KEY));
}
