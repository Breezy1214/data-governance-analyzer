// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => new Map<string, { value: string }>());
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => jar.get(key), has: (key: string) => jar.has(key) }) }));
import { currentSession, forward, SESSION_COOKIE } from "../lib/auth-server";

beforeEach(() => {
  vi.stubEnv("API_BASE_URL", "http://127.0.0.1:8002");
  vi.stubEnv("FRONTEND_SHARED_KEY", "server-only-key");
  vi.stubEnv("APP_ORIGIN", "http://localhost:3002");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); jar.clear(); });

function request(action: string, origin = "http://localhost:3002", body = "{}") {
  return new Request(`http://localhost:3002/api/${action}`, { method: "POST", headers: {
    Origin: origin, "Content-Type": "application/json",
  }, body });
}

describe("server-side authentication boundary", () => {
  it("rejects cross-origin state changes before contacting the backend", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await forward(request("login", "https://attacker.test"), "login");
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("places the session only in an HttpOnly cookie, never in the browser JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ sessionToken: "opaque-private-token",
      user: { id: "user", email: "client@example.test" }, binding: "binding", expiresAt: Date.now() / 1000 + 3600 })));
    const response = await forward(request("login"), "login");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(await response.text()).not.toContain("opaque-private-token");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("forwards server credentials only to the configured backend", async () => {
    jar.set(SESSION_COOKIE, { value: "opaque-private-token" });
    const fetch = vi.fn().mockResolvedValue(Response.json({ score: 1 })); vi.stubGlobal("fetch", fetch);
    await forward(request("assessments"), "assessments");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8002/assessments");
    expect(options.headers.Authorization).toBe("Bearer opaque-private-token");
    expect(options.headers["X-Frontend-Key"]).toBe("server-only-key");
  });

  it("clears a rejected session and sanitizes backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ secret: "database-password" }, { status: 401 })));
    const response = await forward(request("assessments"), "assessments");
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await response.text()).not.toContain("database-password");
  });

  it("does not falsely confirm logout when the backend is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));
    const response = await forward(request("logout"), "logout");
    expect(response.status).toBe(503);
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("clears cookies after confirmed logout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const response = await forward(request("logout"), "logout");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("protects initial page access without trusting client identity", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await currentSession()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects oversized streamed login bodies", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await forward(request("login", undefined, "x".repeat(17000)), "login")).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects GET logout and unknown actions", async () => {
    expect((await forward(new Request("http://localhost:3002/api/logout"), "logout")).status).toBe(405);
    expect((await forward(request("admin"), "admin")).status).toBe(404);
  });
});
