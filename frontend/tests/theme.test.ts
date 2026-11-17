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

type Scheme = "light" | "dark";

/** Resolves a token for a scheme, following var() aliases and picking from light-dark() pairs. */
function token(name: string, scheme: Scheme = "light"): string {
  const value = declared.get(name);
  if (!value) throw new Error(`--${name} is not defined in :root`);
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias) return token(alias[1], scheme);
  const pair = value.match(/^light-dark\((#[0-9a-f]+),\s*(#[0-9a-f]+)\)$/i);
  return pair ? pair[scheme === "light" ? 1 : 2] : value;
}

function luminance(hex: string): number {
  const [r, g, b] = hex.slice(1).match(/../g)!.map((pair) => {
    const channel = parseInt(pair, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string, scheme: Scheme): number {
  const [light, dark] = [luminance(token(a, scheme)), luminance(token(b, scheme))].sort((x, y) => y - x);
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
  ["ink", "fill", 4.5],
  ["ink", "fill-hover", 4.5],
  ["muted", "fill", 4.5],
  ["ink", "button", 4.5],
  ["ink", "button-hover", 4.5],
  ["danger", "button", 4.5],
  ["accent-strong", "surface", 4.5],
  ["accent-strong", "paper", 4.5],
  // Buttons, the current step and selected choices
  ["on-brand", "brand", 4.5],
  ["on-brand", "brand-hover", 4.5],
  ["brand", "brand-soft", 4.5],
  ["ink", "brand-soft", 4.5],
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
  // Non-text: control boundaries, focus rings, progress
  ["control-line", "surface", 3],
  ["focus-ring", "surface", 3],
  ["focus-ring", "paper", 3],
];

describe("colour tokens", () => {
  it.each<Scheme>(["light", "dark"])("meets the WCAG contrast minimum for every %s token pair", (scheme) => {
    const failing = PAIRS.filter(([foreground, background, minimum]) => contrast(foreground, background, scheme) < minimum)
      .map(([foreground, background, minimum]) => `--${foreground} on --${background} needs ${minimum}:1`);
    expect(failing).toEqual([]);
  });

  it("shows the busy spinner only on aria-busy buttons, not on every disabled one", () => {
    expect(css).not.toMatch(/:disabled::before/);
    expect(css).toMatch(/\[aria-busy="true"\]::before/);
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
