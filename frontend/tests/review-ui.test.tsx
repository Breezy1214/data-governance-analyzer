import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewControls } from "../components/ReviewControls";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("submits a selected workspace and refreshes the version", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
  render(<ReviewControls versionId="v" status="draft" userId="owner" context={{ ownerId: "owner", workspaceId: null, role: null, events: [] }}
    workspaces={[{ id: "w", name: "Privacy team", role: "submitter" }]} />);
  expect((screen.getByRole("button", { name: "Submit for review" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "w" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
  await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ workspaceId: "w", status: "in_review", expectedStatus: "draft" });
});
it("requires decision comments and surfaces a stale-state failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Reload before trying again." }, { status: 409 })));
  render(<ReviewControls versionId="v" status="in_review" userId="reviewer" context={{ ownerId: "owner", workspaceId: "w", role: "reviewer", events: [] }} workspaces={[]} />);
  const approve = screen.getByRole("button", { name: "Approve" });
  expect((approve as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Controls verified" } });
  fireEvent.click(approve);
  expect((await screen.findByRole("alert")).textContent).toContain("Reload");
  expect(router.refresh).not.toHaveBeenCalled();
});
it("does not expose decision buttons to the author even when admin", () => {
  render(<ReviewControls versionId="v" status="in_review" userId="owner" context={{ ownerId: "owner", workspaceId: "w", role: "admin", events: [] }} workspaces={[]} />);
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
});
