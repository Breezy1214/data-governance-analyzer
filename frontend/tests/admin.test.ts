// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), getClaims: vi.fn(), getUser: vi.fn(), createServerClient: vi.fn(),
  createClient: vi.fn(), listUsers: vi.fn(), createUser: vi.fn(), updateUserById: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }));
import { GET, POST } from "../app/api/admin/users/route";
import { PATCH } from "../app/api/admin/users/[id]/route";
import { currentSession } from "../lib/auth-server";

const actor = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const adminUser = { id: actor, email: "admin@example.test", is_anonymous: false, app_metadata: { app_role: "admin" } };
const ordinaryUser = { id: target, email: "user@example.test", app_metadata: { app_role: "user" }, user_metadata: { private: "do-not-return" }, identities: [{ secret: "do-not-return" }] };
function request(method = "GET", input?: unknown, origin = "http://localhost:3000", query = "") {
  return new Request("http://localhost:3000/api/admin/users" + query, {
    method, headers: { origin, "Content-Type": "application/json" },
    ...(method !== "GET" ? { body: JSON.stringify(input) } : {}),
  });
}
function patch(input: unknown, id = target) { return PATCH(request("PATCH", input), { params: Promise.resolve({ id }) }); }

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  vi.stubEnv("SUPABASE_SECRET_KEY", "server-secret-never-return");
  vi.stubEnv("APP_ORIGIN", "");vi.stubEnv("VERCEL_URL", "");
  mocks.createServerClient.mockReturnValue({ auth: mocks });
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "signed-test-token" } }, error: null });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: actor, email: adminUser.email, is_anonymous: false, app_metadata: { app_role: "admin" } } }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: adminUser }, error: null });
  mocks.createClient.mockReturnValue({ auth: { admin: mocks } });
  mocks.listUsers.mockResolvedValue({ data: { users: [ordinaryUser] }, error: null });
  mocks.createUser.mockResolvedValue({ data: { user: ordinaryUser }, error: null });
  mocks.updateUserById.mockResolvedValue({ data: { user: ordinaryUser }, error: null });
});
afterEach(() => { vi.unstubAllEnvs();vi.unstubAllGlobals(); });

describe("server-enforced admin access", () => {
  it("rejects signed-out and unverified sessions before creating a privileged client", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    expect((await GET(request())).status).toBe(401);
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "forged" } }, error: null });
    mocks.getClaims.mockResolvedValue({ data: null, error: { status: 401 } });
    expect((await POST(request("POST", {}))).status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("denies user-editable metadata and a stale admin claim on every operation", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { ...adminUser, app_metadata: {}, user_metadata: { app_role: "admin" } } }, error: null });
    for (const response of [await GET(request()), await POST(request("POST", {})), await patch({ role: "admin" })]) {
      expect(response.status).toBe(403);
    }
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("blocks a disabled account and an identity mismatch", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { ...adminUser, banned_until: "2099-01-01T00:00:00Z" } }, error: null });
    expect((await GET(request())).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: { ...adminUser, id: target } }, error: null });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("rechecks live authorization after demotion", async () => {
    expect((await GET(request())).status).toBe(200);
    mocks.getUser.mockResolvedValue({ data: { user: { ...adminUser, app_metadata: { app_role: "user" } } }, error: null });
    expect((await patch({ role: "admin" })).status).toBe(403);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
  });
  it("fails closed during an Auth outage without leaking provider details", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 503, message: "private provider detail" } });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private provider");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("keeps secrets, metadata and credentials out of the paginated response", async () => {
    const response = await GET(request("GET", undefined, undefined, "?page=2"));
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ users: [{ id: target, email: ordinaryUser.email, role: "user", disabled: false }], page: 2, hasMore: false });
    expect(mocks.listUsers).toHaveBeenCalledWith({ page: 2, perPage: 20 });
    expect(mocks.getUser).toHaveBeenCalledWith("signed-test-token");
    expect(mocks.createClient.mock.calls[0][2].auth).toEqual({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  });
  it("uses only verified app metadata for the navigation role", async () => {
    expect((await currentSession())?.user.role).toBe("admin");
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: actor, email: adminUser.email, user_metadata: { app_role: "admin" } } }, error: null });
    expect((await currentSession())?.user.role).toBe("user");
  });
  it("rejects cross-site mutations before asking Auth or account management", async () => {
    expect((await POST(request("POST", {}, "https://other.test"))).status).toBe(403);
    expect((await PATCH(request("PATCH", { role: "admin" }, "https://other.test"), { params: Promise.resolve({ id: target }) })).status).toBe(403);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("reports missing server configuration without exposing it", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SUPABASE_SECRET_KEY");
  });
});

describe("account management boundaries", () => {
  it("creates a confirmed account with server-controlled application role", async () => {
    const response = await POST(request("POST", { email: " new@example.test ", password: "long-test-password", role: "admin" }));
    expect(response.status).toBe(201);
    expect(mocks.createUser).toHaveBeenCalledWith({ email: "new@example.test", password: "long-test-password", email_confirm: true, app_metadata: { app_role: "admin" } });
    const body = await response.text();
    expect(body).not.toMatch(/long-test-password|server-secret|signed-test-token|do-not-return/);
  });
  it.each([{ role: ["admin"] }, { password: "short" }, { email: "bad" }, { app_metadata: { app_role: "admin" } }])("rejects invalid or extra creation fields %j", async (change) => {
    expect((await POST(request("POST", { email: "new@example.test", password: "long-test-password", role: "user", ...change }))).status).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
  it("rejects oversized bodies, including without Content-Length", async () => {
    expect((await POST(request("POST", { password: "x".repeat(5000) }))).status).toBe(413);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("rejects invalid JSON", async () => {
    const req = new Request("http://localhost:3000/api/admin/users", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: "{" });
    expect((await POST(req)).status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it.each(["0", "-1", "1.5", "Infinity", "100001"])("rejects invalid page %s", async (page) => {
    expect((await GET(request("GET", undefined, undefined, "?page=" + page))).status).toBe(400);
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });
  it("updates a role without granting a database service role", async () => {
    expect((await patch({ role: "admin" })).status).toBe(200);
    expect(mocks.updateUserById).toHaveBeenCalledWith(target, { app_metadata: { app_role: "admin" } });
  });
  it("disables and re-enables accounts using explicit provider values", async () => {
    await patch({ disabled: true });
    expect(mocks.updateUserById).toHaveBeenLastCalledWith(target, { ban_duration: "876000h" });
    await patch({ disabled: false });
    expect(mocks.updateUserById).toHaveBeenLastCalledWith(target, { ban_duration: "none" });
  });
  it("allows a password replacement but never returns the password", async () => {
    const response = await patch({ password: "replacement-private-password" });
    expect(response.status).toBe(200);
    expect(mocks.updateUserById).toHaveBeenCalledWith(target, { password: "replacement-private-password" });
    expect(await response.text()).not.toContain("replacement-private-password");
  });
  it.each([{ role: "user" }, { disabled: true }])("prevents self-lockout %j", async (change) => {
    expect((await patch(change, actor)).status).toBe(400);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
  it.each([{ role: "owner" }, { disabled: "true" }, { password: "short" }, { role: "admin", disabled: true }, { user_metadata: {} }])("rejects invalid or mass-assigned updates %j", async (change) => {
    expect((await patch(change)).status).toBe(400);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
  it("rejects an invalid account ID", async () => {
    expect((await patch({ role: "admin" }, "../users")).status).toBe(400);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
  it.each([400, 429, 503])("maps provider status %s without exposing the submitted password", async (status) => {
    mocks.updateUserById.mockResolvedValue({ data: { user: null }, error: { status, message: "secret-provider-data" } });
    const response = await patch({ password: "long-private-password" });
    expect(response.status).toBe(status);
    expect(await response.text()).not.toMatch(/secret-provider-data|long-private-password/);
  });
});
