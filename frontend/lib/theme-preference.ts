import { safely } from "./session";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
const CHANGE_EVENT = "themechange";

/** Runs before first paint (from the root layout), so a saved choice never flashes the other scheme. */
export const APPLY_SAVED_THEME = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function currentTheme(): ThemePreference {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "system";
}

export function setTheme(theme: ThemePreference) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  safely(() => theme === "system"
    ? localStorage.removeItem(THEME_STORAGE_KEY)
    : localStorage.setItem(THEME_STORAGE_KEY, theme));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeToTheme(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}
