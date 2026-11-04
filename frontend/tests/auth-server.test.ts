// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), getClaims: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(),
  createServerClient: vi.fn(), setCookie: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: mocks.setCookie }) }));
import { currentSession, sameOrigin } from "../lib/auth-server";
import { POST as login } from "../app/api/login/route";
import { POST as logout } from "../app/api/logout/route";
import { POST as assess } from "../app/api/assessments/route";
import { GET as session } from "../app/api/session/route";
import { proxy } from "../proxy";
import { NextRequest } from "next/server";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("API_BASE_URL", "http://localhost:8000");
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("VERCEL_URL", "");
  mocks.createServerClient.mockReturnValue({ auth: mocks });
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "private-jwt" } }, error: null });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-id", email: "client@example.test", is_anonymous: false } }, error: null });
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function request(path: string, origin = "http://localhost:3000", body: unknown = { email: "client@example.test", password: "private-password" }) {
  return new Request("http://localhost:3000/api/" + path, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("Supabase authentication routes", () => {
  it("rejects cross-site requests before authentication", async () => {
    const response = await login(request("login", "https://attacker.test"));
    expect(response.status).toBe(403);
    expect((await response.json()).message).toMatch(/verified/);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "https://preview-123.vercel.app"])(
    "accepts same-origin navigation at %s without APP_ORIGIN", (origin) => {
      expect(sameOrigin(new Request(origin + "/api/login", { headers: { origin } }))).toBe(true);
    },
  );

  it("supports explicitly configured deployment origins without allowing other previews", () => {
    vi.stubEnv("VERCEL_URL", "approved.vercel.app");
    expect(sameOrigin(request("login", "https://approved.vercel.app"))).toBe(true);
    expect(sameOrigin(request("login", "https://other.vercel.app"))).toBe(false);
    const req = request("login"); req.headers.set("sec-fetch-site", "cross-site");
    expect(sameOrigin(req)).toBe(false);
  });

  it("handles Next URL normalization using the actual Host, not forwarded host", () => {
    const normalized = new Request("http://localhost:3000/api/login", {
      headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
    });
    expect(sameOrigin(normalized)).toBe(true);
    const forged = new Request("https://real.example/api/login", {
      headers: { origin: "https://attacker.test", host: "real.example", "x-forwarded-host": "attacker.test" },
    });
    expect(sameOrigin(forged)).toBe(false);
  });

  it("uses SSR HttpOnly cookies and never returns tokens in login JSON", async () => {
    const response = await login(request("login"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.cookieOptions).toMatchObject({ name: "session", httpOnly: true, sameSite: "lax", path: "/" });
    options.cookies.setAll([{ name: "session", value: "private-jwt", options: { httpOnly: true } }]);
    expect(mocks.setCookie).toHaveBeenCalledWith("session", "private-jwt", { httpOnly: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("sets secure cookies in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await login(request("login"));
    expect(mocks.createServerClient.mock.calls[0][2].cookieOptions.secure).toBe(true);
  });

  it.each([400, 401, 403, 422])("does not expose account existence on provider status %s", async (status) => {
    mocks.signInWithPassword.mockResolvedValue({ error: { status, message: "account detail" } });
    const response = await login(request("login"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Email or password is incorrect." });
  });

  it.each([429, 503])("preserves provider failure category %s without provider details", async (status) => {
    mocks.signInWithPassword.mockResolvedValue({ error: { status, message: "secret detail" } });
    const response = await login(request("login"));
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("secret detail");
  });

  it("rejects invalid input without a provider call", async () => {
    expect((await login(request("login", undefined, { email: [], password: "" }))).status).toBe(400);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("forwards only a verified token and the unchanged body to FastAPI", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ score: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await assess(request("assessments", undefined, { schemaVersion: "2.0" }));
    expect(response.status).toBe(200);
    expect(mocks.getClaims).toHaveBeenCalledWith("private-jwt");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe("http://localhost:8000/assessments");
    expect(options.headers.Authorization).toBe("Bearer private-jwt");
    expect(options.headers["X-Frontend-Key"]).toBeUndefined();
    expect(options.body).toBeInstanceOf(ReadableStream);
  });

  it.each([401, 413, 422, 503])("preserves backend status and safe message %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Backend message" }, { status })));
    const response = await assess(request("assessments"));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ message: "Backend message" });
  });

  it("does not trust an unverified cookie session", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: { status: 400, name: "AuthInvalidJwtError" } });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await assess(request("assessments"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns no session for a signed-out visitor", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    expect(await currentSession()).toBeNull();
    expect((await session()).status).toBe(401);
  });

  it("keeps authentication outages distinct from being signed out", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: { status: 503 } });
    await expect(currentSession()).rejects.toThrow(/unavailable/);
    expect((await session()).status).toBe(503);
  });

  it("reports missing configuration instead of redirecting to login", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    await expect(currentSession()).rejects.toThrow(/configuration/);
    expect((await session()).status).toBe(503);
  });

  it("confirms sign-out only after Supabase accepts it", async () => {
    expect((await logout(request("logout"))).status).toBe(200);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    mocks.signOut.mockResolvedValue({ error: { status: 503 } });
    expect((await logout(request("logout"))).status).toBe(503);
  });

  it("refreshes cookies on both the downstream request and browser response", async () => {
    mocks.getClaims.mockImplementation(async () => {
      mocks.createServerClient.mock.calls[0][2].cookies.setAll([
        { name: "session", value: "refreshed", options: { httpOnly: true, sameSite: "lax", path: "/" } },
      ]);
      return { data: { claims: { sub: "user-id" } }, error: null };
    });
    const req = new NextRequest("https://example.test/");
    const response = await proxy(req);
    expect(req.cookies.get("session")?.value).toBe("refreshed");
    expect(response.cookies.get("session")?.value).toBe("refreshed");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("leaves outage reporting to the page instead of failing in the proxy", async () => {
    mocks.getClaims.mockRejectedValue(new Error("auth down"));
    const response = await proxy(new NextRequest("https://example.test/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("ignores cookie writes that Server Components cannot perform", async () => {
    mocks.setCookie.mockImplementation(() => { throw new Error("read-only cookies"); });
    mocks.getSession.mockImplementation(async () => {
      mocks.createServerClient.mock.calls[0][2].cookies.setAll([{ name: "session", value: "refreshed", options: {} }]);
      return { data: { session: { access_token: "private-jwt" } }, error: null };
    });
    expect(await currentSession()).toEqual({ user: { id: "user-id", email: "client@example.test", role: "user" } });
  });
});
