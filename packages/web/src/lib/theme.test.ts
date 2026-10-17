import { afterEach, describe, expect, it, vi } from "vitest";
import { preferences } from "./preferences";
import { applyTheme, isDarkTheme } from "./theme";

type Listener = () => void;

function stubSystemScheme(initial: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: initial,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  };
  vi.spyOn(window, "matchMedia").mockReturnValue(query as unknown as MediaQueryList);
  return (dark: boolean) => {
    query.matches = dark;
    for (const listener of listeners) listener();
  };
}

const isDark = () => document.documentElement.classList.contains("dark");

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("isDarkTheme", () => {
  it("lets an explicit choice win over the system", () => {
    expect(isDarkTheme("light", true)).toBe(false);
    expect(isDarkTheme("dark", false)).toBe(true);
    expect(isDarkTheme("system", true)).toBe(true);
  });
});

describe("applyTheme", () => {
  it("follows the preference live", () => {
    stubSystemScheme(false);
    const stop = applyTheme();
    expect(isDark()).toBe(false);
    preferences.setTheme("dark");
    expect(isDark()).toBe(true);
    preferences.setTheme("light");
    expect(isDark()).toBe(false);
    stop();
  });

  it("follows the system scheme only while the theme is system", () => {
    const setSystemDark = stubSystemScheme(false);
    const stop = applyTheme();
    setSystemDark(true);
    expect(isDark()).toBe(true);
    preferences.setTheme("light");
    setSystemDark(true);
    expect(isDark()).toBe(false);
    stop();
  });

  it("stops listening after unsubscribe", () => {
    stubSystemScheme(false);
    applyTheme()();
    preferences.setTheme("dark");
    expect(isDark()).toBe(false);
  });
});
