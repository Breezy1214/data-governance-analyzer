import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssessmentInput,
  ASSESSMENT_TIMEOUT_MS,
  requestAssessment,
  validateDescription,
  validateQuestions,
} from "../lib/assessment";
import { assessmentResult, hangingFetch, stubAssessmentApi } from "./assessment-fixture";

const baseline: AssessmentInput = {
  description: "Match customer email addresses with a partner for campaign measurement.",
  dataTypes: ["emails"],
  externalAccess: "yes",
  rawExchange: "no",
  dataMovement: "no",
  combined: "no",
  secondaryUse: "no",
  purpose: "matching",
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.test");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("assessment client", () => {
  it("provides plain-language validation", () => {
    expect(validateDescription("short")).toMatch(/more detail/i);
    expect(validateQuestions({ ...baseline, rawExchange: "" })).toMatch(/each Yes or No/i);
  });

  it("sends an explicit schema version to the assessment API", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.test/");
    const fetchMock = stubAssessmentApi();

    const result = await requestAssessment(baseline);
    expect(result).toEqual(assessmentResult);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/assessments");

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({ schemaVersion: "2.0" });
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

  it("fails when the assessment API is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");
    const fetchMock = stubAssessmentApi();

    await expect(requestAssessment(baseline)).rejects.toThrow("Assessment service is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
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
    { ...assessmentResult, recommendationDetails: [{ ...assessmentResult.recommendationDetails[0], riskFactorIds: ["UNKNOWN_RULE"] }] },
    { ...assessmentResult, recommendationDetails: [{ ...assessmentResult.recommendationDetails[0], priority: 2 }] },
    { ...assessmentResult, assessedAt: "not a date" },
    { ...assessmentResult, mappingVersion: undefined },
    { ...assessmentResult, mappingVersion: "99.0" },
    { ...assessmentResult, mappingApprovalStatus: "pending" },
    { ...assessmentResult, generalSafeguards: [] },
    { ...assessmentResult, capabilities: [] },
    { ...assessmentResult, karlsgateRecommendations: [{ ...assessmentResult.karlsgateRecommendations[0], text: "Unsupported claim" }] },
    { ...assessmentResult, karlsgateRecommendations: [{ ...assessmentResult.karlsgateRecommendations[0], conditionId: "UNKNOWN" }] },
    { ...assessmentResult, karlsgateRecommendations: [assessmentResult.karlsgateRecommendations[0], assessmentResult.karlsgateRecommendations[0]] },
    { ...assessmentResult, karlsgateRecommendations: assessmentResult.karlsgateRecommendations.slice(1), capabilities: assessmentResult.capabilities.slice(1) },
    { ...assessmentResult, karlsgateRecommendations: [...assessmentResult.karlsgateRecommendations].reverse(), capabilities: [...assessmentResult.capabilities].reverse() },
  ])("rejects a malformed API response: %j", async (body) => {
    stubAssessmentApi(new Response(JSON.stringify(body)));
    await expect(requestAssessment(baseline)).rejects.toThrow("invalid response");
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
