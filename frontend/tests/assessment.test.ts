import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSESSMENT_TIMEOUT_MS,
  CHOICE_FIELDS,
  isAssessmentInput,
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
    expect(validateQuestions(baseline)).toBeNull();
  });

  it("requires an answer to every single-choice question", () => {
    CHOICE_FIELDS.forEach((field) => {
      expect(validateQuestions({ ...baseline, [field]: "" })).not.toBeNull();
    });
  });

  it("sends every answer the rubric uses and nothing else", () => {
    const { description, ...scored } = baseline;
    expect(description).toBeTruthy();
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

    const result = await requestAssessment(baseline);
    expect(result).toEqual(assessmentResult);
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

  it.each([
    null,
    {},
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
    { ...assessmentResult, mappingApprovalStatus: "unknown" },
    { ...assessmentResult, sourcesCheckedOn: "not a date" },
    { ...assessmentResult, score: 90 },
    { ...assessmentResult, factors: [...assessmentResult.factors, assessmentResult.factors[0]] },
  ])("rejects a malformed API response: %j", async (body) => {
    stubAssessmentApi(new Response(JSON.stringify(body)));
    await expect(requestAssessment(baseline)).rejects.toThrow("invalid response");
  });

  it("accepts recommendation text from the backend without a local catalog", async () => {
    const changed = { ...assessmentResult, recommendations: [{ ...assessmentResult.recommendations[0], action: "Text the client has never seen." }] };
    stubAssessmentApi(new Response(JSON.stringify(changed)));
    await expect(requestAssessment(baseline)).resolves.toEqual(changed);
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
