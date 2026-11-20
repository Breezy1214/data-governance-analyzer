import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "../components/ThemeToggle";
import { APPLY_SAVED_THEME, THEME_STORAGE_KEY } from "../lib/theme-preference";
import { expectNoViolations } from "./axe";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme switch", () => {
  it("is an accessible radio group that follows the device by default", async () => {
    const { container } = render(<ThemeToggle />);
    expect(screen.getByRole("group", { name: "Colour theme" })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Match device" }).checked).toBe(true);
    await expectNoViolations(container);
  });

  it("applies and remembers a manual choice, and forgets it when set back to the device", () => {
    render(<ThemeToggle />);
    act(() => { fireEvent.click(screen.getByRole("radio", { name: "Dark" })); });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Dark" }).checked).toBe(true);

    act(() => { fireEvent.click(screen.getByRole("radio", { name: "Match device" })); });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("restores a saved choice before the page renders and ignores unknown values", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    new Function(APPLY_SAVED_THEME)();
    expect(document.documentElement.dataset.theme).toBe("light");

    delete document.documentElement.dataset.theme;
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    new Function(APPLY_SAVED_THEME)();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
