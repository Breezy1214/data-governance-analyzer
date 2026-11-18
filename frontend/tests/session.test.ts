import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_INPUT } from "../lib/assessment";
import { DRAFT_KEY, IDLE_TIMEOUT_MS, clearDraft, loadSession, purgeLegacyDrafts, reachableStep, saveDraft } from "../lib/session";
import { assessmentResult, completeInput } from "./assessment-fixture";

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  getItem(key: string) { return this.items.get(key) ?? null; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string) { this.items.delete(key); }
  setItem(key: string, value: string) { this.items.set(key, value); }
}

const draft = { ...EMPTY_INPUT, description: "Share loyalty member emails with a partner brand." };
let session: MemoryStorage;
let local: MemoryStorage;

beforeEach(() => {
  session = new MemoryStorage();
  local = new MemoryStorage();
});

afterEach(() => vi.restoreAllMocks());

describe("session-scoped draft storage", () => {
  it("round-trips a draft within the session", () => {
    saveDraft({ input: draft }, session);
    expect(session.getItem(DRAFT_KEY)).toContain("loyalty");
    expect(loadSession(session)?.input).toEqual(draft);
  });

  it("never writes personal values from the description to storage", () => {
    saveDraft({ input: { ...draft, description: "Email jane.doe@example.com the SSN 123-45-6789." } }, session);
    const stored = session.getItem(DRAFT_KEY) ?? "";
    expect(stored).not.toContain("jane.doe");
    expect(stored).not.toContain("123-45-6789");
    expect(loadSession(session)?.input.description).toBe("Email [email] the SSN [ID number].");
  });

  it("redacts a draft saved before screening existed", () => {
    session.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), input: { ...draft, description: "Call 208-555-0147." } }));
    expect(loadSession(session)?.input.description).toBe("Call [phone].");
  });

  it("discards a draft after the idle timeout", () => {
    saveDraft({ input: draft }, session, 0);
    expect(loadSession(session, IDLE_TIMEOUT_MS - 1)?.input).toEqual(draft);
    expect(loadSession(session, IDLE_TIMEOUT_MS)).toBeNull();
    expect(session.getItem(DRAFT_KEY)).toBeNull();
  });

  it("removes drafts left in localStorage by earlier builds", () => {
    local.setItem("governance-assessment-draft-v1", JSON.stringify(draft));
    purgeLegacyDrafts(local);
    expect(local.length).toBe(0);
  });

  it("drops corrupted drafts instead of throwing", () => {
    session.setItem(DRAFT_KEY, "{not json");
    expect(loadSession(session)).toBeNull();
    expect(session.getItem(DRAFT_KEY)).toBeNull();
  });

  it("discards invalid drafts", () => {
    for (const input of [null, { ...draft, dataTypes: null }, { ...draft, description: 42 }, { ...draft, purpose: "unknown" }]) {
      session.setItem(DRAFT_KEY, JSON.stringify({ savedAt: 100, input }));
      expect(loadSession(session, 100), JSON.stringify(input)).toBeNull();
      expect(session.getItem(DRAFT_KEY)).toBeNull();
    }
  });

  it("discards timestamps in the future", () => {
    saveDraft({ input: draft }, session, 101);
    expect(loadSession(session, 100)).toBeNull();
  });

  it("handles browser storage getters throwing before storage access", () => {
    const blocked = () => { throw new DOMException("blocked", "SecurityError"); };
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(blocked);
    vi.spyOn(window, "localStorage", "get").mockImplementation(blocked);
    expect(() => saveDraft({ input: draft })).not.toThrow();
    expect(() => clearDraft()).not.toThrow();
    expect(() => purgeLegacyDrafts()).not.toThrow();
    expect(loadSession()).toBeNull();
  });

  describe("restoring the screen after a refresh", () => {
    it("restores the step and result alongside the answers", () => {
      saveDraft({ input: completeInput, step: 3, result: assessmentResult }, session, 100);
      expect(loadSession(session, 100)).toEqual({ input: completeInput, step: 3, result: assessmentResult });
    });

    it("falls back to the questions when a results step has no valid result", () => {
      saveDraft({ input: completeInput, step: 2, result: null }, session, 100);
      expect(loadSession(session, 100)).toMatchObject({ step: 1, result: null });
      session.setItem(DRAFT_KEY, JSON.stringify({ savedAt: 100, input: completeInput, step: 2, result: { ...assessmentResult, score: 7 } }));
      expect(loadSession(session, 100)).toMatchObject({ step: 1, result: null });
    });

    it("never restores past the description step without a valid description", () => {
      saveDraft({ input: { ...completeInput, description: "short" }, step: 1, result: null }, session, 100);
      expect(loadSession(session, 100)?.step).toBe(0);
      session.setItem(DRAFT_KEY, JSON.stringify({ savedAt: 100, input: completeInput, step: 9 }));
      expect(loadSession(session, 100)?.step).toBe(0);
    });

    it("restores drafts saved by the previous build, which had no step or result", () => {
      session.setItem(DRAFT_KEY, JSON.stringify({ savedAt: 100, input: { ...draft, purpose: "overlap" } }));
      expect(loadSession(session, 100)).toMatchObject({ step: 0, result: null });
    });

    it("restores where the result was saved, and a failed save so it can be retried", () => {
      const saved = { assessmentId: "7d1c3b1e-6a8f-4c2d-9b1a-2f5e8c9d0a11", version: 2 };
      saveDraft({ input: completeInput, step: 3, result: assessmentResult, saved, savedTo: saved.assessmentId }, session, 100);
      expect(loadSession(session, 100)).toMatchObject({ saved, savedTo: saved.assessmentId });
      saveDraft({ input: completeInput, step: 2, result: assessmentResult, saved: null }, session, 100);
      expect(loadSession(session, 100)).toMatchObject({ step: 2, saved: null });
    });

    it("drops a save status without its result, and a malformed save target", () => {
      const saved = { assessmentId: "7d1c3b1e-6a8f-4c2d-9b1a-2f5e8c9d0a11", version: 1 };
      saveDraft({ input: completeInput, step: 1, result: null, saved, savedTo: saved.assessmentId }, session, 100);
      const restored = loadSession(session, 100);
      expect(restored).not.toHaveProperty("saved");
      expect(restored?.savedTo).toBe(saved.assessmentId);
      session.setItem(DRAFT_KEY, JSON.stringify({ savedAt: 100, input: completeInput, savedTo: "../admin" }));
      expect(loadSession(session, 100)).not.toHaveProperty("savedTo");
    });

    it("caps a step at what the answers can reach", () => {
      expect(reachableStep(3, completeInput, assessmentResult)).toBe(3);
      expect(reachableStep(3, completeInput, null)).toBe(1);
      expect(reachableStep(2, { ...completeInput, description: "short" }, assessmentResult)).toBe(0);
      expect(reachableStep(0, completeInput, assessmentResult)).toBe(0);
    });

    it("expires a saved result with the draft", () => {
      saveDraft({ input: completeInput, step: 2, result: assessmentResult }, session, 0);
      expect(loadSession(session, IDLE_TIMEOUT_MS)).toBeNull();
    });
  });
});
