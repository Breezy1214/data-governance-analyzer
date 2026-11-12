// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toScoringPayload } from "../lib/assessment";
import { assessmentResult, completeInput, stubAssessmentApi } from "./assessment-fixture";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(), getSession: vi.fn(), getClaims: vi.fn(), rpc: vi.fn(), from: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }));
import { POST as assess } from "../app/api/assessments/route";
import { POST as reassess } from "../app/api/assessments/[id]/versions/route";
import { DELETE as remove } from "../app/api/assessments/[id]/route";
import { POST as assessDemo } from "../app/api/demo/assessments/route";

const ASSESSMENT_ID = "6f1c2a5e-3b4d-4c8e-9a7f-0123456789ab";
const ANSWERS = { schemaVersion: "3.0", ...toScoringPayload(completeInput) };
const SCORED = { ...assessmentResult, answers: ANSWERS };

/** A Supabase query builder that resolves `existing` from maybeSingle() and `written` when awaited directly. */
function table(existing: unknown, written: unknown = { data: [], error: null }) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "delete"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => existing);
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(written).then(resolve, reject);
  return query;
}

function post(path: string, body: unknown = ANSWERS, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000/api/${path}`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const context = (id = ASSESSMENT_ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("API_BASE_URL", "http://localhost:8000");
  mocks.createServerClient.mockReturnValue({
    auth: { getSession: mocks.getSession, getClaims: mocks.getClaims }, rpc: mocks.rpc, from: mocks.from,
  });
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "private-jwt" } }, error: null });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-id", email: "client@example.test", is_anonymous: false } }, error: null });
  mocks.rpc.mockResolvedValue({ data: { assessment_id: ASSESSMENT_ID, version: 1 }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("saving a completed assessment", () => {
  it("saves FastAPI's result and the answers FastAPI accepted, not the raw request", async () => {
    stubAssessmentApi(Response.json(SCORED));
    const response = await assess(post("assessments", { ...ANSWERS, purpose: "fraud" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    expect(await response.json()).toEqual({ ...assessmentResult, saved: { assessmentId: ASSESSMENT_ID, version: 1 } });
    expect(mocks.rpc).toHaveBeenCalledWith("save_assessment_version", {
      scored_answers: ANSWERS, scored_result: assessmentResult, target_assessment: null,
    });
  });

  // FastAPI rejects unknown fields, so a description or a browser-supplied score never reaches the register.
  it.each([401, 413, 422, 429, 503])("saves nothing when FastAPI answers %s, and passes its answer on", async (status) => {
    stubAssessmentApi(Response.json({ message: "Backend message" }, { status }));
    const response = await assess(post("assessments", { ...ANSWERS, description: "Jane Doe", score: 0 }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ message: "Backend message" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("saves nothing when FastAPI returns a malformed result", async () => {
    stubAssessmentApi(Response.json({ ...SCORED, score: 3 }));
    expect((await assess(post("assessments"))).status).toBe(502);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("still returns the result when the register is unavailable", async () => {
    stubAssessmentApi(Response.json(SCORED));
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST000" } });
    const response = await assess(post("assessments"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...assessmentResult, saved: null });
  });

  it("requires a signed-in session and a same-origin request", async () => {
    const fetchMock = stubAssessmentApi(Response.json(SCORED));
    expect((await assess(post("assessments", ANSWERS, "https://attacker.test"))).status).toBe(403);
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    expect((await assess(post("assessments"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("re-assessing a saved assessment", () => {
  it("saves the new result as the next version of the same assessment", async () => {
    stubAssessmentApi(Response.json(SCORED));
    mocks.rpc.mockResolvedValue({ data: { assessment_id: ASSESSMENT_ID, version: 2 }, error: null });

    const response = await reassess(post(`assessments/${ASSESSMENT_ID}/versions`), context());
    expect((await response.json()).saved).toEqual({ assessmentId: ASSESSMENT_ID, version: 2 });
    expect(mocks.rpc.mock.calls[0][1].target_assessment).toBe(ASSESSMENT_ID);
  });

  it("returns 404 when the assessment isn't visible to this user", async () => {
    stubAssessmentApi(Response.json(SCORED));
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    expect((await reassess(post(`assessments/${ASSESSMENT_ID}/versions`), context())).status).toBe(404);
  });

  it("returns 404 for an ID that isn't a UUID without scoring", async () => {
    const fetchMock = stubAssessmentApi(Response.json(SCORED));
    expect((await reassess(post("assessments/not-an-id/versions"), context("not-an-id"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("deleting a saved assessment", () => {
  function del(origin = "http://localhost:3000") {
    return new Request(`http://localhost:3000/api/assessments/${ASSESSMENT_ID}`, { method: "DELETE", headers: { Origin: origin } });
  }

  it("deletes the assessment with all its versions", async () => {
    const query = table({ data: { id: ASSESSMENT_ID }, error: null }, { data: [{ id: ASSESSMENT_ID }], error: null });
    mocks.from.mockReturnValue(query);
    const response = await remove(del(), context());
    expect(response.status).toBe(204);
    expect(query.delete).toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith("id", ASSESSMENT_ID);
  });

  it("reports a conflict when row-level security keeps a reviewed assessment", async () => {
    mocks.from.mockReturnValue(table({ data: { id: ASSESSMENT_ID }, error: null }, { data: [], error: null }));
    const response = await remove(del(), context());
    expect(response.status).toBe(409);
    expect((await response.json()).message).toMatch(/in review or approved/);
  });

  it("reports 404 for an assessment that isn't visible to this user", async () => {
    mocks.from.mockReturnValue(table({ data: null, error: null }, { data: [], error: null }));
    expect((await remove(del(), context())).status).toBe(404);
  });

  it("rejects cross-site deletes before touching the register", async () => {
    expect((await remove(del("https://attacker.test"), context())).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe("demo mode", () => {
  it("scores without a session and never touches the register", async () => {
    stubAssessmentApi(Response.json(SCORED));
    const response = await assessDemo(post("demo/assessments"));
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("saved");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
