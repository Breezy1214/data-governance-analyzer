import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTE, RISK_COLORS } from "../lib/theme";

/**
 * Colour system checks (SCRUM-24). jsdom cannot measure rendered contrast,
 * so these read the tokens straight from the stylesheet and hold them to
 * WCAG AA: 4.5:1 for text, 3:1 for control boundaries, focus indicators
 * and meaningful graphics.
 */

const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
const rootBlock = css.match(/:root\s*{([^}]*)}/)![1];

const declared = new Map(
  [...rootBlock.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
);

function token(name: string): string {
  const value = declared.get(name);
  if (!value) throw new Error(`--${name} is not defined in :root`);
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  return alias ? token(alias[1]) : value;
}

function luminance(hex: string): number {
  const [r, g, b] = hex.slice(1).match(/../g)!.map((pair) => {
    const channel = parseInt(pair, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(token(a)), luminance(token(b))].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// [foreground, background, minimum ratio]
const PAIRS: [string, string, number][] = [
  // Text on light surfaces
  ["ink", "surface", 4.5],
  ["ink", "paper", 4.5],
  ["ink", "surface-hover", 4.5],
  ["muted", "surface", 4.5],
  ["muted", "paper", 4.5],
  ["muted", "surface-hover", 4.5],
  ["accent-strong", "surface", 4.5],
  ["accent-strong", "paper", 4.5],
  // Buttons and selected choices
  ["white", "ink", 4.5],
  ["white", "ink-hover", 4.5],
  ["white", "danger-hover", 4.5],
  ["danger", "surface", 4.5],
  ["disabled-fg", "disabled-bg", 4.5],
  // Feedback states
  ["danger", "danger-bg", 4.5],
  ["warning", "warning-bg", 4.5],
  ["success", "success-bg", 4.5],
  // Risk levels as text
  ["risk-low", "surface", 4.5],
  ["risk-medium", "surface", 4.5],
  ["risk-high", "surface", 4.5],
  // Text on the dark panels
  ["on-ink", "ink", 4.5],
  ["on-ink-muted", "ink", 4.5],
  ["on-ink-dim", "ink", 4.5],
  ["on-ink-strong", "ink", 4.5],
  ["accent", "ink", 4.5],
  // Non-text: control boundaries, focus rings, progress
  ["control-line", "surface", 3],
  ["focus-ring", "surface", 3],
  ["focus-ring", "paper", 3],
  ["focus-ring-on-dark", "ink", 3],
  ["accent", "ink-line", 3],
];

describe("colour tokens", () => {
  it.each(PAIRS)("--%s on --%s meets %s:1", (foreground, background, minimum) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });

  it("keeps raw colour values inside the :root token block", () => {
    const outsideRoot = css.replace(rootBlock, "");
    expect(outsideRoot.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? []).toEqual([]);
  });

  it("keeps the PDF palette in step with the stylesheet", () => {
    expect(PALETTE).toEqual({
      ink: token("ink"),
      muted: token("muted"),
      line: token("line"),
      success: token("success"),
      warning: token("warning"),
      danger: token("danger"),
    });
    expect(RISK_COLORS).toEqual({ LOW: token("risk-low"), MEDIUM: token("risk-medium"), HIGH: token("risk-high") });
  });

  it("gives each risk level its own colour", () => {
    expect(new Set(Object.values(RISK_COLORS)).size).toBe(3);
  });
});
