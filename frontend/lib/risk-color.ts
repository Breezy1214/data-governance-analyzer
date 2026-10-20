const LOW_RISK_RGB = [40, 122, 63] as const;
const HIGH_RISK_RGB = [179, 38, 30] as const;

/** Linearly interpolate the result colour from green (0) to red (100). */
export function riskColor(score: number): string {
  const amount = Math.min(100, Math.max(0, score)) / 100;
  const channels = LOW_RISK_RGB.map((low, index) =>
    Math.round(low + (HIGH_RISK_RGB[index] - low) * amount),
  );

  return `rgb(${channels.join(", ")})`;
}
