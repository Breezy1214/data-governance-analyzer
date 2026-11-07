import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminConsole } from "../components/AdminConsole";
import { AUTH_EVENT } from "../lib/auth-client";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const user = { id: "user-id", email: "teammate@example.test", role: "user", disabled: false };
const page = { users: [user], page: 1, hasMore: false };
afterEach(() => { cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();router.replace.mockClear(); });

describe("admin account screen", () => {
  it("loads accounts without requesting or displaying passwords", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(page));vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole actorId="admin-id" />);
    expect(await screen.findByRole("heading", { name: user.email })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/users?page=1", expect.objectContaining({ cache: "no-store" }));
    expect(screen.getByRole("link", { name: "Open assessments" }).getAttribute("href")).toBe("/");
  });
  it("creates the selected role and immediately clears the submitted password on failure", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options?: RequestInit) =>
      options?.method === "POST" ? Response.json({ message: "Check account details." }, { status: 400 }) : Response.json(page));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole actorId="admin-id" />);
    await screen.findByRole("heading", { name: user.email });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.test" } });
    const password = screen.getByLabelText("Initial password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "private-test-password" } });
    fireEvent.change(screen.getByLabelText("Account role"), { target: { value: "admin" } });
    fireEvent.submit(password.closest("form")!);
    expect(password.value).toBe("");
    await screen.findByText("Check account details.");
    const call = fetchMock.mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(JSON.parse(call[1].body as string)).toEqual({ email: "new@example.test", password: "private-test-password", role: "admin" });
  });
  it("requires confirmation before promoting an account", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(page));vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminConsole actorId="admin-id" />);
    fireEvent.click(await screen.findByRole("button", { name: "Make admin" }));
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });
  it("clears account information when the next request denies admin access", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(page)).mockResolvedValue(Response.json({ message: "An administrator account is required." }, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminConsole actorId="admin-id" />);
    await screen.findByRole("heading", { name: user.email });
    fireEvent.click(screen.getByRole("button", { name: "Refresh accounts" }));
    await screen.findByRole("heading", { name: "Admin access locked" });
    expect(screen.queryByText(user.email)).toBeNull();
    expect(screen.queryByLabelText("Initial password")).toBeNull();
  });
  it("locks the account list when another tab signs out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(page)));
    render(<AdminConsole actorId="admin-id" />);
    await screen.findByRole("heading", { name: user.email });
    fireEvent(window, new StorageEvent("storage", { key: AUTH_EVENT, newValue: "signed-out" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText(user.email)).toBeNull();
  });
  it("does not offer self-demotion or self-disable controls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(page)));
    render(<AdminConsole actorId={user.id} />);
    await screen.findByRole("heading", { name: user.email + " (you)" });
    expect(screen.queryByRole("button", { name: "Make admin" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disable account" })).toBeNull();
  });
});
