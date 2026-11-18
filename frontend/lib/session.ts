import {
  AssessmentResult,
  DraftInput,
  SavedVersion,
  isAssessmentResult,
  isDraftInput,
  isSavedVersion,
  validateDescription,
} from "./assessment";
import { isUuid } from "./register";
import { redactSensitiveData } from "./sensitive-data";

/** The draft lives in this tab's sessionStorage and is cleared on tab close, idle timeout or start-over (SCRUM-16). Saved assessments are separate (docs/data-handling.md). */

export const DRAFT_KEY = "governance-assessment-draft-v2";
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Earlier builds kept drafts in localStorage with no expiry.
const LEGACY_KEYS = ["governance-assessment-draft-v1"];

export type Step = 0 | 1 | 2 | 3;

/** The furthest screen these answers can show: the questions need a valid description, and the results need a result. */
export function reachableStep(requested: Step, input: DraftInput, result: AssessmentResult | null): Step {
  const ceiling: Step = validateDescription(input.description) !== null ? 0 : result ? 3 : 1;
  return Math.min(requested, ceiling) as Step;
}

/**
 * What a refresh restores: the answers, the screen, the last result for those answers and where it was saved (SCRUM-28).
 * `saved` follows the wizard: undefined when this endpoint never saves, null when saving the result failed.
 */
export type SessionState = {
  input: DraftInput;
  step: Step;
  result: AssessmentResult | null;
  saved?: SavedVersion | null;
  savedTo?: string;
};

type StoredDraft = { savedAt: number; input: DraftInput; step?: number; result?: unknown; saved?: unknown; savedTo?: unknown };

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
function withoutSensitiveData(input: DraftInput): DraftInput {
  return { ...input, description: redactSensitiveData(input.description) };
}

export function saveDraft(state: Partial<SessionState> & Pick<SessionState, "input">, storage?: Storage, now = Date.now()): void {
  const { input, step, result, saved, savedTo } = state;
  const draft: StoredDraft = {
    savedAt: now,
    input: withoutSensitiveData(input),
    step,
    savedTo,
    // A save status only describes the result it came with.
    ...(result && { result, saved }),
  };
  safely(() => (storage ?? window.sessionStorage).setItem(DRAFT_KEY, JSON.stringify(draft)));
}

/**
 * Restores the session, or returns null (and clears storage) if it is
 * expired or malformed. A step that is no longer reachable falls back to
 * the furthest one that is (see `reachableStep`).
 */
export function loadSession(storage?: Storage, now = Date.now()): SessionState | null {
  const raw = safely(() => (storage ?? window.sessionStorage).getItem(DRAFT_KEY), null);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as StoredDraft;
    if (!draft || !Number.isFinite(draft.savedAt) || draft.savedAt > now
      || now - draft.savedAt >= IDLE_TIMEOUT_MS || !isDraftInput(draft.input)) {
      clearDraft(storage);
      return null;
    }
    const input = withoutSensitiveData(draft.input);
    const result = isAssessmentResult(draft.result) ? draft.result : null;
    const requested = [0, 1, 2, 3].includes(draft.step as number) ? (draft.step as Step) : 0;
    const saved = !result ? undefined : isSavedVersion(draft.saved) ? draft.saved : draft.saved === null ? null : undefined;
    return {
      input,
      step: reachableStep(requested, input, result),
      result,
      ...(saved !== undefined && { saved }),
      ...(isUuid(draft.savedTo) && { savedTo: draft.savedTo }),
    };
  } catch {
    clearDraft(storage);
    return null;
  }
}

export function clearDraft(storage?: Storage): void {
  safely(() => (storage ?? window.sessionStorage).removeItem(DRAFT_KEY));
}
