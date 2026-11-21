import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewControls } from "../components/ReviewControls";
import { WorkspaceControls } from "../components/WorkspaceControls";
import type { ReviewContext } from "../lib/review";
import { approvalEvent } from "./assessment-fixture";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const context = (overrides: Partial<ReviewContext> = {}): ReviewContext =>
  ({ workspaceId: "w", role: null, events: [], ...overrides });

const twoWorkspaces = [{ id: "w", name: "Privacy team", role: "submitter" as const, reviewers: 1 }, { id: "x", name: "Legal", role: "reviewer" as const, reviewers: 1 }];
const submitted = { ...approvalEvent, id: 1, actor_id: "owner", actor_name: "owner@example.test", from_status: "draft" as const, to_status: "in_review" as const, comment: "" };

it("submits a selected workspace and refreshes the version", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  render(<ReviewControls versionId="v" status="draft" isOwner context={context({ workspaceId: null })} workspaces={twoWorkspaces} />);
  const submit = screen.getByRole("button", { name: "Submit for review" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "Workspace" }), { target: { value: "w" } });
  fireEvent.click(submit);
  await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ workspaceId: "w", status: "in_review", expectedStatus: "draft" });
});

it("submits straight to an author's only workspace", () => {
  render(<ReviewControls versionId="v" status="draft" isOwner context={context({ workspaceId: null })} workspaces={twoWorkspaces.slice(0, 1)} />);
  expect(screen.queryByRole("combobox", { name: "Workspace" })).toBeNull();
  expect((screen.getByRole("button", { name: "Submit to Privacy team" }) as HTMLButtonElement).disabled).toBe(false);
});

it("requires a decision comment and shows a stale-state failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Reload before trying again." }, { status: 409 })));
  render(<ReviewControls versionId="v" status="in_review" isOwner={false} context={context({ role: "reviewer", events: [submitted] })} workspaces={[]} />);
  expect(screen.getByText(/Submitted by owner@example.test/)).toBeTruthy();
  const approve = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
  expect(approve.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: /comment/i }), { target: { value: "Controls verified" } });
  fireEvent.click(approve);
  expect((await screen.findByRole("alert")).textContent).toContain("Reload");
  expect(router.refresh).not.toHaveBeenCalled();
});

it("shows an author only where their submission stands, even as admin", () => {
  render(<ReviewControls versionId="v" status="in_review" isOwner context={context({ role: "admin", events: [submitted] })}
    workspaces={[{ id: "w", name: "Privacy team", role: "admin", reviewers: 1 }]} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText("Waiting for a reviewer in Privacy team.")).toBeTruthy();
  const history = screen.getByRole("list").textContent;
  expect(history).toContain("Submitted for review");
  expect(history).toContain("owner@example.test");
  expect(history).not.toContain("2026-11-14T12:00:00Z");
});

it("shows who decided and their comment", () => {
  render(<ReviewControls versionId="v" status="approved" isOwner context={context({ events: [submitted, approvalEvent] })} workspaces={[]} />);
  expect(screen.getByText(/Approved by reviewer@example.test/)).toBeTruthy();
  expect(screen.getAllByText(approvalEvent.comment).length).toBeGreaterThan(0);
});

it("points an author with no workspace to Workspace reviews", () => {
  render(<ReviewControls versionId="v" status="draft" isOwner context={context({ workspaceId: null })} workspaces={[]} />);
  expect(screen.queryByRole("button", { name: /Submit/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Workspace reviews" }).getAttribute("href")).toBe("/reviews");
});

it("offers creating a workspace and explains roles when there are none", () => {
  render(<WorkspaceControls userId="me" workspaces={[]} />);
  expect(screen.getByText(/not in a workspace yet/)).toBeTruthy();
  for (const role of ["Submitter", "Reviewer", "Admin"]) expect(screen.getByText(role, { selector: "dt" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
  expect(screen.getByRole("textbox", { name: "Workspace name" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Add a member" })).toBeNull();
});

it("adds a member to an admin's only workspace", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceControls userId="me" workspaces={[{ id: "w", name: "Privacy team", role: "admin", reviewers: 1 }]} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Member account ID" }), { target: { value: " them " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ action: "member", workspaceId: "w", userId: "them", role: "reviewer" });
});

it("hides member management from someone who is not an admin", () => {
  render(<WorkspaceControls userId="me" workspaces={[{ id: "w", name: "Privacy team", role: "reviewer", reviewers: 1 }]} />);
  expect(screen.getByText("Privacy team")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Member account ID" })).toBeNull();
});

it("explains why an admin can't change their own role without calling the API", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<WorkspaceControls userId="me" workspaces={[{ id: "w", name: "Privacy team", role: "admin", reviewers: 1 }]} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Member account ID" }), { target: { value: " me " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert").textContent).toContain("can’t change your own role");
  expect(fetcher).not.toHaveBeenCalled();
});

it("warns an author when no one else in the workspace can review", () => {
  const alone = [{ id: "w", name: "Privacy team", role: "admin" as const, reviewers: 0 }];
  render(<ReviewControls versionId="v" status="in_review" isOwner context={context({ role: "admin", events: [submitted] })} workspaces={alone} />);
  expect(screen.getByText(/No one else in Privacy team can review this yet/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Add a reviewer" }).getAttribute("href")).toBe("/reviews");
  expect(screen.queryByText(/Waiting for a reviewer/)).toBeNull();
  cleanup();
  render(<ReviewControls versionId="v" status="in_review" isOwner context={context({ role: "admin", events: [submitted] })}
    workspaces={[{ ...alone[0], reviewers: 1 }]} />);
  expect(screen.queryByText(/No one else/)).toBeNull();
});
