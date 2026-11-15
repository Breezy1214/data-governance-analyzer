import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authenticated: vi.fn(), context: vi.fn(), spaces: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/auth-server", async (original) => ({ ...await original<object>(), authenticatedSession: mocks.authenticated }));
vi.mock("../lib/review-server", () => ({ reviewContext: mocks.context, reviewWorkspaces: mocks.spaces,
  reviewClient: () => ({ rpc: mocks.rpc }), reviewFailure: () => {} }));
import { POST } from "../app/api/reviews/route";
import { AuthenticationError } from "../lib/auth-server";
const id = "00000000-0000-4000-8000-000000000001";
function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/reviews", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) });
}
const decision = { action: "transition", versionId: id, workspaceId: id, status: "approved", expectedStatus: "in_review", note: "Controls reviewed" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticated.mockResolvedValue({ client: {}, payload: { user: { id: "actor" } } });
  mocks.context.mockResolvedValue({ ownerId: "author", role: "reviewer", workspaceId: id, events: [] });
  mocks.spaces.mockResolvedValue([{ id, role: "reviewer" }]);
  mocks.rpc.mockResolvedValue({ error: null });
});
it("denies signed-out and cross-site requests without a database write", async () => {
  expect((await POST(request(decision, "https://other.test"))).status).toBe(403);
  mocks.authenticated.mockRejectedValue(new AuthenticationError(401, "Sign in"));
  expect((await POST(request(decision))).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("denies self-approval even for admins and denies ordinary submitters", async () => {
  for (const context of [{ ownerId: "actor", role: "admin" }, { ownerId: "author", role: "submitter" }, { ownerId: "author", role: null }]) {
    mocks.context.mockResolvedValue(context);
    expect((await POST(request(decision))).status).toBe(403);
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("requires a comment then sends a permitted decision with its expected state", async () => {
  expect((await POST(request({ ...decision, note: " " }))).status).toBe(400);
  expect((await POST(request(decision))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("transition_review", { v_id: id, w_id: id, next_status: "approved", note: "Controls reviewed", expected_status: "in_review" });
});
