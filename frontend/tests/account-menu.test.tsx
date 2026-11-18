import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { AccountMenu } from "../components/AccountMenu";

afterEach(cleanup);

/** The browser fires `toggle` whenever the popover opens or closes, including Esc and outside clicks. */
function toggle(panel: HTMLElement, newState: "open" | "closed") {
  fireEvent(panel, Object.assign(new Event("toggle"), { newState, oldState: newState === "open" ? "closed" : "open" }));
}

describe("AccountMenu", () => {
  it("keeps aria-expanded in step with the popover however it opens or closes", () => {
    render(<AccountMenu email="client@example.test" />);
    const trigger = screen.getByRole("button", { name: "Account, client@example.test" });
    const panel = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    expect(trigger.getAttribute("popovertarget")).toBe(panel.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    toggle(panel, "open");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    toggle(panel, "closed");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
