"use client";

import { useSyncExternalStore } from "react";
import { type ThemePreference, currentTheme, setTheme, subscribeToTheme } from "@/lib/theme-preference";
import { Icon } from "./Icons";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Match device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** A segmented control of native radios: one tab stop, arrow keys to switch. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, () => "system" as const);
  return (
    <fieldset className="theme-toggle">
      <legend className="sr-only">Colour theme</legend>
      {OPTIONS.map(({ value, label }) => (
        <label key={value} title={label}>
          <input className="choice-input" type="radio" name="theme" value={value} checked={theme === value} onChange={() => setTheme(value)} />
          <Icon name={value} size={16} />
          <span className="sr-only">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
