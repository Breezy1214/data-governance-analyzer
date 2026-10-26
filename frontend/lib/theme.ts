import type { RiskLevel } from "./assessment";

/**
 * Colour tokens for code that cannot read CSS variables, such as the PDF
 * report. Values mirror the :root tokens in app/globals.css (SCRUM-24);
 * change both together. All text colours meet WCAG AA (4.5:1) on white.
 */
export const PALETTE = {
  ink: "#14213d",
  muted: "#5a6474",
  line: "#c9ced6",
  success: "#2e6a4a",
  warning: "#9a4a0b",
  danger: "#a8322a",
} as const;

export const RISK_COLORS: Record<RiskLevel, string> = {
  LOW: PALETTE.success,
  MEDIUM: PALETTE.warning,
  HIGH: PALETTE.danger,
};
