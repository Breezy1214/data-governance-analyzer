import axe from "axe-core";
import { expect } from "vitest";

/** Machine-checkable WCAG failures. Colour contrast cannot be judged in jsdom, so it is excluded. */
const AXE_OPTIONS: axe.RunOptions = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  rules: { "color-contrast": { enabled: false } },
};

export async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, AXE_OPTIONS);
  const summary = results.violations.map(
    (violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`,
  );
  expect(summary).toEqual([]);
}
