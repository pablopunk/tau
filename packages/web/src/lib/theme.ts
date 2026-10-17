import { preferences, type Theme } from "./preferences";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export const isDarkTheme = (theme: Theme, systemDark: boolean): boolean =>
  theme === "dark" || (theme === "system" && systemDark);

const darkQuery = (): MediaQueryList => window.matchMedia(DARK_QUERY);

function paint(): void {
  const dark = isDarkTheme(preferences.getTheme(), darkQuery().matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Paints now, then repaints on preference changes and on system changes. Returns the unsubscribe. */
export function applyTheme(): () => void {
  paint();
  const query = darkQuery();
  const unsubscribe = preferences.subscribeTheme(paint);
  query.addEventListener("change", paint);
  return () => {
    unsubscribe();
    query.removeEventListener("change", paint);
  };
}
