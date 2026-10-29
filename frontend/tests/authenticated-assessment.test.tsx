import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedAssessment } from "../components/AuthenticatedAssessment";
import { AUTH_EVENT } from "../lib/auth-client";
import { DRAFT_KEY } from "../lib/session";
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("../components/AssessmentWizard", () => ({
  AssessmentWizard: ({ account }: { account: React.ReactNode }) => {
    const [result, setResult] = useState(false);
    return <main><header>{account}</header>
      <button onClick={() => setResult(true)}>Complete test assessment</button>
      {result && <p>Assessment result retained</p>}</main>;
  },
}));

const session = { user: { id: "user", email: "client@example.test" }, binding: "user" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); sessionStorage.clear(); router.replace.mockClear(); });

describe("authenticated wizard lifecycle", () => {
  it("keeps the mounted result across visibility checks and temporary outages", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(session));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthenticatedAssessment session={session} />);
    fireEvent.click(screen.getByText("Complete test assessment"));
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Assessment result retained")).toBeTruthy();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/still here/));
    expect(screen.getByText("Assessment result retained")).toBeTruthy();
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("Assessment result retained")).toBeTruthy();
    expect(document.querySelectorAll("header").length).toBe(1);
  });

  it("uses one polling interval and no activity endpoint", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(Response.json(session));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthenticatedAssessment session={session} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "a" });
    await act(() => vi.advanceTimersByTimeAsync(60000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/session");
  });

  it("locks and clears private state on confirmed expiry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 401 })));
    render(<AuthenticatedAssessment session={session} />);
    sessionStorage.setItem(DRAFT_KEY, "private");
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Assessment locked."));
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(screen.queryByText("Complete test assessment")).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/login?reason=expired");
  });

  it("locks other tabs when sign-out is announced", () => {
    render(<AuthenticatedAssessment session={session} />);
    sessionStorage.setItem(DRAFT_KEY, "private");
    fireEvent(window, new StorageEvent("storage", { key: AUTH_EVENT, newValue: "changed" }));
    expect(screen.getByRole("status").textContent).toBe("Assessment locked.");
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("keeps work hidden and offers retry if logout fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 503 })));
    render(<AuthenticatedAssessment session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be confirmed/));
    expect(screen.getByRole("button", { name: "Retry sign out" })).toBeTruthy();
    expect(screen.queryByText("Complete test assessment")).toBeNull();
  });
});
