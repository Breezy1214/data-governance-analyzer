import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmLinkForm, ForgotPasswordForm, SignupForm } from "../components/AccountForms";
import { LoginForm } from "../components/LoginForm";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const respondWith = (body: unknown, status = 200) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status })));

function fillSignup(password = "plum kettle orbit lantern") {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: " new@example.test " } });
  const field = screen.getByLabelText("Password") as HTMLInputElement;
  fireEvent.change(field, { target: { value: password } });
  fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
  return field;
}

describe("sign-up form", () => {
  it("works with password managers and explains the password rules", () => {
    render(<SignupForm />);
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.autocomplete).toBe("new-password");
    expect((screen.getByLabelText("Email address") as HTMLInputElement).autocomplete).toBe("email");
    expect(document.getElementById(password.getAttribute("aria-describedby")!)?.textContent).toMatch(/at least 15 characters/);
  });

  it("can show the password", () => {
    render(<SignupForm />);
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.click(screen.getByLabelText("Show password"));
    expect(password.type).toBe("text");
  });

  it("asks the person to check their email without confirming the account is new", async () => {
    respondWith({ ok: true });
    render(<SignupForm />);
    fillSignup();
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/new@example.test/));
    expect(screen.getByRole("status").textContent).toMatch(/already have an account/);
  });

  it("shows the server's reason and clears the password", async () => {
    respondWith({ message: "This password has appeared in a data breach." }, 400);
    render(<SignupForm />);
    const password = fillSignup();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/data breach/));
    expect(password.value).toBe("");
  });

  it("reports a lost connection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<SignupForm />);
    fillSignup();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Unable to connect/));
  });
});

describe("emailed links", () => {
  it("waits for a click, so email scanners can't use up the link", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<ConfirmLinkForm tokenHash="abc" type="email" />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm email" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("explains a link with no token and offers no button", () => {
    render(<ConfirmLinkForm tokenHash="" type="email" />);
    expect(screen.getByRole("alert").textContent).toMatch(/expired/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("gives the same reset answer whether or not the account exists", async () => {
    respondWith({ ok: true });
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.test" } });
    fireEvent.submit(screen.getByRole("button", { name: "Send reset link" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/If an account exists/));
  });
});

describe("sign-in page", () => {
  it("links to account creation and password reset", () => {
    render(<LoginForm />);
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe("/signup");
    expect(screen.getByRole("link", { name: "Forgot your password?" }).getAttribute("href")).toBe("/forgot-password");
  });
});
