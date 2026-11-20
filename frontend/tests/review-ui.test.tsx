import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewControls } from "../components/ReviewControls";
import type { ReviewContext } from "../lib/review";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const context = (overrides: Partial<ReviewContext> = {}): ReviewContext =>
  ({ ownerId: "owner", workspaceId: "w", role: null, events: [], ...overrides });

it("submits a selected workspace and refreshes the version", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  render(<ReviewControls versionId="v" status="draft" isOwner context={context({ workspaceId: null })}
    workspaces={[{ id: "w", name: "Privacy team", role: "submitter" }]} />);
  const submit = screen.getByRole("button", { name: "Submit for review" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "Workspace" }), { target: { value: "w" } });
  fireEvent.click(submit);
  await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ workspaceId: "w", status: "in_review", expectedStatus: "draft" });
});

it("requires a decision comment and shows a stale-state failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Reload before trying again." }, { status: 409 })));
  render(<ReviewControls versionId="v" status="in_review" isOwner={false} context={context({ role: "reviewer" })} workspaces={[]} />);
  const approve = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
  expect(approve.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: /comment/i }), { target: { value: "Controls verified" } });
  fireEvent.click(approve);
  expect((await screen.findByRole("alert")).textContent).toContain("Reload");
  expect(router.refresh).not.toHaveBeenCalled();
});

it("gives the author no decision buttons even as admin, and shows a readable history", () => {
  render(<ReviewControls versionId="v" status="in_review" isOwner context={context({
    role: "admin",
    events: [{ id: 1, version_id: "v", assessment_id: "a", version: 1, actor_id: "owner", actor_label: "owner", actor_name: "owner@example.test",
      occurred_at: "2026-11-14T12:00:00Z", from_status: "draft", to_status: "in_review", comment: "Ready", rules_version: "2.0", mapping_version: "2.0" }],
  })} workspaces={[]} />);
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  const history = screen.getByRole("list").textContent;
  expect(history).toContain("Draft → In review");
  expect(history).toContain("owner@example.test");
  expect(history).not.toContain("2026-11-14T12:00:00Z");
});
