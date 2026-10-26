import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "../components/LoginForm";
import { bindDraft, clearPrivateState } from "../lib/auth-client";
import { DRAFT_KEY } from "../lib/session";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

describe("sign in", () => {
  it("uses accessible fields and does not reveal account existence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "client@example.test" } });
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "private-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Email or password is incorrect."));
    expect(password.value).toBe("");
  });

  it("reports unavailable authentication without provider details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret upstream details", { status: 503 })));
    render(<LoginForm />);
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not available/));
    expect(document.body.textContent).not.toContain("secret upstream details");
  });

  it("disables repeated submission while signing in", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<LoginForm />);
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
    expect((screen.getByRole("button", { name: "Signing in..." }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("draft isolation", () => {
  it("retains drafts for the same session but clears them on account/session change", () => {
    bindDraft("session-a");
    sessionStorage.setItem(DRAFT_KEY, "private draft");
    bindDraft("session-a");
    expect(sessionStorage.getItem(DRAFT_KEY)).toBe("private draft");
    bindDraft("session-b");
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });
  it("clears private state on logout", () => {
    sessionStorage.setItem(DRAFT_KEY, "private draft");
    clearPrivateState();
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
