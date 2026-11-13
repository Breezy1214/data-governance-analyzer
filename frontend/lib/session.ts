import { AssessmentInput, AssessmentResult, isAssessmentInput, isAssessmentResult, validateDescription } from "./assessment";
import { redactSensitiveData } from "./sensitive-data";

/** v1.0 retains nothing: the draft lives in this tab's sessionStorage and is cleared on tab close, idle timeout or start-over (SCRUM-16, docs/data-handling.md). */

export const DRAFT_KEY = "governance-assessment-draft-v2";
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Earlier builds kept drafts in localStorage with no expiry.
const LEGACY_KEYS = ["governance-assessment-draft-v1"];

export type Step = 0 | 1 | 2 | 3;

/** What a refresh restores: the answers, the screen, and the last result for those answers (SCRUM-28). */
export type SessionState = { input: AssessmentInput; step: Step; result: AssessmentResult | null };

type StoredDraft = { savedAt: number; input: AssessmentInput; step?: number; result?: unknown };

export function safely<T>(action: () => T, fallback?: T): T | undefined {
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

/** Personal values typed into the description are never written to storage, only their placeholders. */
function withoutSensitiveData(input: AssessmentInput): AssessmentInput {
  return { ...input, description: redactSensitiveData(input.description) };
}

export function saveDraft(
  input: AssessmentInput,
  storage?: Storage,
  now = Date.now(),
  view?: { step: Step; result: AssessmentResult | null },
): void {
  const draft: StoredDraft = {
    savedAt: now,
    input: withoutSensitiveData(input),
    ...(view && { step: view.step, result: view.result ?? undefined }),
  };
  safely(() => (storage ?? window.sessionStorage).setItem(DRAFT_KEY, JSON.stringify(draft)));
}

/**
 * Restores the session, or returns null (and clears storage) if it is
 * expired or malformed. A step that is no longer reachable falls back to
 * the furthest valid one: results steps need a valid result, and the
 * questions step needs a valid description.
 */
export function loadSession(storage?: Storage, now = Date.now()): SessionState | null {
  const raw = safely(() => (storage ?? window.sessionStorage).getItem(DRAFT_KEY), null);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as StoredDraft;
    if (!draft || !Number.isFinite(draft.savedAt) || draft.savedAt > now
      || now - draft.savedAt >= IDLE_TIMEOUT_MS || !isAssessmentInput(draft.input)) {
      clearDraft(storage);
      return null;
    }
    const input = withoutSensitiveData(draft.input);
    const result = isAssessmentResult(draft.result) ? draft.result : null;
    const describable = validateDescription(input.description) === null;
    const requested = [0, 1, 2, 3].includes(draft.step as number) ? (draft.step as Step) : 0;
    const step: Step = requested >= 2 ? (result ? requested : describable ? 1 : 0)
      : requested === 1 && !describable ? 0 : requested;
    return { input, step, result };
  } catch {
    clearDraft(storage);
    return null;
  }
}

export function loadDraft(storage?: Storage, now = Date.now()): AssessmentInput | null {
  return loadSession(storage, now)?.input ?? null;
}

export function clearDraft(storage?: Storage): void {
  safely(() => (storage ?? window.sessionStorage).removeItem(DRAFT_KEY));
}
