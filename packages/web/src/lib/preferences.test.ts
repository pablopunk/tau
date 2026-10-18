import { beforeEach, describe, expect, it, vi } from "vitest";
import { preferences } from "./preferences";

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("preferences", () => {
  it("remembers the last project, model, thinking level and notifications", () => {
    expect(preferences.getLastProjectId()).toBeNull();
    preferences.setLastProjectId("p1");
    preferences.setLastModel({ provider: "faux", modelId: "faux-1" });
    preferences.setLastThinkingLevel("high");
    preferences.setNotificationsEnabled(true);
    expect(preferences.getLastProjectId()).toBe("p1");
    expect(preferences.getLastModel()).toEqual({ provider: "faux", modelId: "faux-1" });
    expect(preferences.getLastThinkingLevel()).toBe("high");
    expect(preferences.getNotificationsEnabled()).toBe(true);
  });

  it("defaults the theme to system, stores it and tells subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = preferences.subscribeTheme(listener);
    expect(preferences.getTheme()).toBe("system");
    preferences.setTheme("dark");
    expect(preferences.getTheme()).toBe("dark");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    preferences.setTheme("light");
    expect(listener).toHaveBeenCalledTimes(1);
    window.localStorage.setItem("tau:theme", "neon");
    expect(preferences.getTheme()).toBe("system");
  });

  it("keeps lastSeenAt per thread", () => {
    preferences.setLastSeenAt("1", 100);
    preferences.setLastSeenAt("2", 200);
    expect(preferences.getLastSeenAt("1")).toBe(100);
    expect(preferences.getLastSeenAt("2")).toBe(200);
    expect(preferences.getLastSeenAt("3")).toBeNull();
  });

  it("sets the seen baseline once, on first load", () => {
    expect(preferences.getSeenBaseline(500)).toBe(500);
    expect(preferences.getSeenBaseline(900)).toBe(500);
  });

  it("ignores corrupt values", () => {
    window.localStorage.setItem("tau:last-model", "{nope");
    expect(preferences.getLastModel()).toBeNull();
  });

  it("works without storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(preferences.getLastProjectId()).toBeNull();
    expect(() => preferences.setLastProjectId("p1")).not.toThrow();
    expect(preferences.getNotificationsEnabled()).toBe(false);
  });

  it("remembers the sidebar mode and the closed projects", () => {
    expect(preferences.getSidebarMode()).toBe("threads");
    preferences.setSidebarMode("projects");
    expect(window.localStorage.getItem("tau-sidebar-mode")).toBe("projects");
    expect(preferences.getSidebarMode()).toBe("projects");
    expect(preferences.getProjectOpenOverrides()).toEqual({});
    preferences.setProjectOpenOverrides({ a: false, b: true });
    expect(preferences.getProjectOpenOverrides()).toEqual({ a: false, b: true });
    window.localStorage.setItem("tau-sidebar-project-overrides", "{oops");
    expect(preferences.getProjectOpenOverrides()).toEqual({});
  });

  it("reads the legacy closed list as closed overrides, new overrides winning", () => {
    window.localStorage.setItem("tau-sidebar-closed-projects", '["a","b"]');
    expect(preferences.getProjectOpenOverrides()).toEqual({ a: false, b: false });
    preferences.setProjectOpenOverrides({ b: true });
    expect(preferences.getProjectOpenOverrides()).toEqual({ a: false, b: true });
  });
});
