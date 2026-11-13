// Light / dark / follow the phone. The choice is saved with the other settings
// and applied as data-theme on <html>, which style.css keys its colours off.
// (index.html applies it too, before first paint, so there's no flash.)

import { data, save } from "./store";

export type Theme = "system" | "light" | "dark";

export const currentTheme = (): Theme => data.settings.theme ?? "system";

export function applyTheme() {
  const theme = currentTheme();
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  // Match the phone's status bar to the page.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const forMedia = m.getAttribute("media")?.includes("dark") ? "#000000" : "#f2f2f2";
    m.setAttribute("content", theme === "dark" ? "#000000" : theme === "light" ? "#f2f2f2" : forMedia);
  });
}

export function setTheme(theme: Theme) {
  data.settings.theme = theme;
  save();
}
