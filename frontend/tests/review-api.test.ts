import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authenticated: vi.fn(), forward: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/auth-server", async (original) => ({ ...await original<object>(), authenticatedSession: mocks.authenticated }));
vi.mock("../lib/backend-proxy", () => ({ forwardToBackend: mocks.forward, bearer: (t: string) => ({ Authorization: `Bearer ${t}` }) }));
import { POST } from "../app/api/reviews/route";
import { AuthenticationError } from "../lib/auth-server";
function request(origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/reviews", { method: "POST", headers: { Origin: origin }, body: JSON.stringify({ action: "create", name: "Team" }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticated.mockResolvedValue({ accessToken: "verified-session-token" });
});
it("denies signed-out and cross-site requests without forwarding", async () => {
  expect((await POST(request("https://other.test"))).status).toBe(403);
  mocks.authenticated.mockRejectedValue(new AuthenticationError(401, "Sign in"));
  expect((await POST(request())).status).toBe(401);
  expect(mocks.forward).not.toHaveBeenCalled();
});
it.each([200, 400, 403, 409, 503])("relays backend status %s using the verified session", async (status) => {
  mocks.forward.mockResolvedValue(Response.json({ message: "Result" }, { status }));
  const req = request();
  expect((await POST(req)).status).toBe(status);
  expect(mocks.forward).toHaveBeenCalledWith(req, "/reviews", { Authorization: "Bearer verified-session-token" });
});
