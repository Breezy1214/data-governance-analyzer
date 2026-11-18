import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSESSMENT_TIMEOUT_MS,
  EMPTY_INPUT,
  completeAnswers,
  isAssessmentInput,
  isAssessmentResult,
  isDraftInput,
  requestAssessment,
  toggleRegulation,
  toScoringPayload,
  validateDescription,
  validateQuestions,
} from "../lib/assessment";
import { assessmentResult, completeInput as baseline, hangingFetch, stubAssessmentApi } from "./assessment-fixture";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("assessment client", () => {
  it("provides plain-language validation", () => {
    expect(validateDescription("short")).toMatch(/more detail/i);
    expect(validateQuestions({ ...baseline, identifierProtection: "" })).toMatch(/answer every question/i);
    expect(validateQuestions({ ...baseline, dataTypes: [] })).toMatch(/type of information/i);
    expect(validateQuestions({ ...baseline, regulations: [] })).toMatch(/not sure/i);
    expect(validateQuestions({ ...baseline, purpose: "" })).toMatch(/intended use/i);
    expect(validateQuestions(baseline)).toBeNull();
  });

  it("sends every answer the rubric uses and nothing else", () => {
    const scored = Object.fromEntries(Object.entries(baseline).filter(([field]) => field !== "description"));
    expect(toScoringPayload(baseline)).toEqual(scored);
  });

  it("keeps None of these and Not sure exclusive from named regulations", () => {
    expect(toggleRegulation(["gdpr"], "hipaa")).toEqual(["gdpr", "hipaa"]);
    expect(toggleRegulation(["gdpr", "hipaa"], "none")).toEqual(["none"]);
    expect(toggleRegulation(["notSure"], "gdpr")).toEqual(["gdpr"]);
    expect(toggleRegulation(["none"], "notSure")).toEqual(["notSure"]);
    expect(toggleRegulation(["gdpr"], "gdpr")).toEqual([]);
  });

  it("rejects drafts from the retired questionnaire", () => {
    expect(isAssessmentInput(baseline)).toBe(true);
    expect(isAssessmentInput({
      description: "An older draft", dataTypes: ["emails"], externalAccess: "yes", rawExchange: "no",
      dataMovement: "no", combined: "no", secondaryUse: "no", purpose: "matching",
    })).toBe(false);
  });

  it("sends an explicit schema version to the assessment API", async () => {
    const fetchMock = stubAssessmentApi();

    const outcome = await requestAssessment(baseline);
    expect(outcome).toEqual({ result: assessmentResult });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/assessments");

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({ schemaVersion: "3.0" });
  });

  it("never sends the free-text description to the assessment API", async () => {
    const fetchMock = stubAssessmentApi();

    await requestAssessment(baseline);

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.body).not.toContain(baseline.description);
    expect(JSON.parse(request.body as string)).not.toHaveProperty("description");
    expect(request.cache).toBe("no-store");
  });

  it("fails when the configured API is unreachable", async () => {
    stubAssessmentApi(new TypeError("network unavailable"));

    await expect(requestAssessment(baseline)).rejects.toThrow("network unavailable");
  });

  it("does not hide an API validation error with a local score", async () => {
    stubAssessmentApi(new Response(null, { status: 422 }));

    await expect(requestAssessment(baseline)).rejects.toThrow("Assessment service returned 422");
  });

  it("rejects malformed API responses", async () => {
    for (const body of [
      null,
      { ...assessmentResult, schemaVersion: "1.0" },
      { ...assessmentResult, score: 101 },
      { ...assessmentResult, level: "UNKNOWN" },
      { ...assessmentResult, factors: [null] },
      { ...assessmentResult, recommendations: [{ ...assessmentResult.recommendations[0], priority: 2 }] },
      { ...assessmentResult, recommendations: [assessmentResult.recommendations[0], { ...assessmentResult.recommendations[0], priority: 2 }] },
      { ...assessmentResult, recommendations: [{ ...assessmentResult.recommendations[0], basedOn: null }] },
      { ...assessmentResult, recommendations: [{ ...assessmentResult.recommendations[0], references: [{ ...assessmentResult.recommendations[0].references[0], sourceUrl: "javascript:alert(1)" }] }] },
      { ...assessmentResult, recommendations: [{ ...assessmentResult.recommendations[0], references: [{ ...assessmentResult.recommendations[0].references[0], statement: "" }] }] },
      { ...assessmentResult, recommendations: undefined },
      { ...assessmentResult, assessedAt: "not a date" },
      { ...assessmentResult, mappingVersion: undefined },
      { ...assessmentResult, apiVersion: undefined },
      { ...assessmentResult, mappingApprovalStatus: "unknown" },
      { ...assessmentResult, sourcesCheckedOn: "not a date" },
      { ...assessmentResult, score: 90 },
      { ...assessmentResult, factors: [...assessmentResult.factors, assessmentResult.factors[0]] },
    ]) {
      stubAssessmentApi(new Response(JSON.stringify(body)));
      await expect(requestAssessment(baseline), JSON.stringify(body)).rejects.toThrow("invalid response");
    }
  });

  it("accepts recommendation text from the backend without a local catalog", async () => {
    const changed = { ...assessmentResult, recommendations: [{ ...assessmentResult.recommendations[0], action: "Text the client has never seen." }] };
    stubAssessmentApi(new Response(JSON.stringify(changed)));
    await expect(requestAssessment(baseline)).resolves.toEqual({ result: changed });
  });

  it("reports where a signed-in result was saved, separately from the result", async () => {
    stubAssessmentApi(Response.json({ ...assessmentResult, saved: { assessmentId: "a1", version: 2 } }));
    await expect(requestAssessment(baseline)).resolves.toEqual({
      result: assessmentResult, saved: { assessmentId: "a1", version: 2 },
    });
  });

  it("treats a failed or malformed save as not saved", async () => {
    for (const saved of [null, { assessmentId: "a1" }, { assessmentId: "a1", version: 0 }]) {
      stubAssessmentApi(Response.json({ ...assessmentResult, saved }));
      await expect(requestAssessment(baseline), JSON.stringify(saved)).resolves.toEqual({ result: assessmentResult, saved: null });
    }
  });

  it("rejects invalid JSON", async () => {
    stubAssessmentApi(new Response("not json"));
    await expect(requestAssessment(baseline)).rejects.toThrow("invalid response");
  });

  it("aborts hung requests and releases the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(hangingFetch));
    const assertion = expect(requestAssessment(baseline)).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(ASSESSMENT_TIMEOUT_MS);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up the timeout and cancellation listener after success", async () => {
    vi.useFakeTimers();
    stubAssessmentApi();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await requestAssessment(baseline, controller.signal);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("questionnaire defaults and scale", () => {
  it("starts with no purpose selected so it cannot silently add points", () => {
    const unpicked = { ...baseline, purpose: EMPTY_INPUT.purpose };
    expect(EMPTY_INPUT.purpose).toBe("");
    expect(isDraftInput(EMPTY_INPUT)).toBe(true);
    expect(validateQuestions(unpicked)).not.toBeNull();
    expect(completeAnswers(unpicked)).toBeNull();
    expect(completeAnswers(baseline)).toEqual(baseline);
  });

  it("only treats answers with an intended use as scoreable", () => {
    expect(isAssessmentInput({ ...baseline, purpose: "" })).toBe(false);
    expect(isDraftInput({ ...baseline, purpose: "" })).toBe(true);
    expect(isDraftInput({ ...baseline, purpose: "unknown" })).toBe(false);
  });

  it("accepts the factor scale the API sends, and results saved before it was sent", () => {
    const older = { ...assessmentResult, maxFactorPoints: undefined };
    expect(isAssessmentResult(assessmentResult)).toBe(true);
    expect(isAssessmentResult(older)).toBe(true);
    // A scale smaller than a factor it scales, or not a positive whole number, is not one the API produced.
    expect(isAssessmentResult({ ...assessmentResult, maxFactorPoints: 12 })).toBe(false);
    expect(isAssessmentResult({ ...assessmentResult, maxFactorPoints: 0 })).toBe(false);
    expect(isAssessmentResult({ ...assessmentResult, maxFactorPoints: "24" })).toBe(false);
  });
});
