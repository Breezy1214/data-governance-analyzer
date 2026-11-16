// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn(), getSession: vi.fn(), getClaims: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }));
import { POST as assess } from "../app/api/assessments/route";
import { POST as reassess } from "../app/api/assessments/[id]/versions/route";
import { DELETE as remove } from "../app/api/assessments/[id]/route";

const ID = "6f1c2a5e-3b4d-4c8e-9a7f-0123456789ab";
const context = { params: Promise.resolve({ id: ID }) };

function call(path: string, method: string, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000/api/${path}`, {
    method, headers: { Origin: origin, "Content-Type": "application/json" },
    body: method === "DELETE" ? undefined : JSON.stringify({ dataTypes: ["emails"] }),
  });
}

function stubBackend(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("API_BASE_URL", "http://localhost:8000");
  mocks.createServerClient.mockReturnValue({ auth: { getSession: mocks.getSession, getClaims: mocks.getClaims } });
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "private-jwt" } }, error: null });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-id", email: "client@example.test", is_anonymous: false } }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("register routes", () => {
  // The API scores and saves in one step, so the browser can only send answers, never a result.
  it("forward to the API with the user's token and relay its answer", async () => {
    for (const [handler, path, method, backendPath] of [
      [() => assess(call("assessments", "POST")), "assessments", "POST", "/assessments"],
      [() => reassess(call(`assessments/${ID}/versions`, "POST"), context), "versions", "POST", `/assessments/${ID}/versions`],
      [() => remove(call(`assessments/${ID}`, "DELETE"), context), "delete", "DELETE", `/assessments/${ID}`],
    ] as const) {
      const fetchMock = stubBackend(Response.json({ message: "Backend message" }, { status: 409 }));
      const response = await handler();
      const [url, options] = fetchMock.mock.calls[0];
      expect(url.toString(), path).toBe(`http://localhost:8000${backendPath}`);
      expect(options.method).toBe(method);
      expect(options.headers.Authorization).toBe("Bearer private-jwt");
      expect(response.status).toBe(409);
      expect(response.headers.get("cache-control")).toMatch(/no-store/);
      expect(await response.json()).toEqual({ message: "Backend message" });
    }
  });

  it("relays a successful delete without a body", async () => {
    stubBackend(new Response(null, { status: 204 }));
    expect((await remove(call(`assessments/${ID}`, "DELETE"), context)).status).toBe(204);
  });

  it("require a signed-in session and a same-origin request", async () => {
    const fetchMock = stubBackend(Response.json({}));
    expect((await remove(call(`assessments/${ID}`, "DELETE", "https://attacker.test"), context)).status).toBe(403);
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    expect((await assess(call("assessments", "POST"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
