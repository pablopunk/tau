import type { ModelRef, ThinkingLevel } from "@tau/protocol";
import { clampSidebarWidth, SIDEBAR_WIDTH_DEFAULT } from "./sidebar-width";

const PREFIX = "tau:";
const KEYS = {
  lastProject: `${PREFIX}last-project`,
  lastModel: `${PREFIX}last-model`,
  lastThinkingLevel: `${PREFIX}last-thinking-level`,
  notifications: `${PREFIX}notifications`,
  lastSeenAt: `${PREFIX}last-seen-at`,
  seenBaseline: `${PREFIX}seen-baseline`,
  sidebarMode: "tau-sidebar-mode",
  closedProjects: "tau-sidebar-closed-projects",
  projectOpenOverrides: "tau-sidebar-project-overrides",
  collapsedThreads: "tau-sidebar-collapsed-threads",
  theme: `${PREFIX}theme`,
  sidebarOpen: `${PREFIX}sidebar-open`,
  sidebarWidth: `${PREFIX}sidebar-width`,
} as const;

function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is unavailable (private mode, quota): preferences just do not persist.
  }
}

function readJson<T>(key: string, isValid: (value: unknown) => value is T): T | null {
  const raw = readString(key);
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : null;
  } catch {
    return null;
  }
}

const isModelRef = (value: unknown): value is ModelRef =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as ModelRef).provider === "string" &&
  typeof (value as ModelRef).modelId === "string";

const isNumberRecord = (value: unknown): value is Record<string, number> =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every((entry) => typeof entry === "number");

export type SidebarMode = "threads" | "projects";
export type Theme = "system" | "light" | "dark";

const isTheme = (value: string | null): value is Theme =>
  value === "system" || value === "light" || value === "dark";

const themeListeners = new Set<() => void>();

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isBooleanRecord = (value: unknown): value is Record<string, boolean> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === "boolean");

const legacyClosedAsOverrides = (ids: readonly string[]): Record<string, boolean> =>
  Object.fromEntries(ids.map((id) => [id, false]));

export const preferences = {
  getSidebarMode: (): SidebarMode => (readString(KEYS.sidebarMode) === "projects" ? "projects" : "threads"),
  setSidebarMode: (mode: SidebarMode): void => writeString(KEYS.sidebarMode, mode),

  getSidebarOpen: (): boolean => readString(KEYS.sidebarOpen) !== "closed",
  setSidebarOpen: (open: boolean): void => writeString(KEYS.sidebarOpen, open ? "open" : "closed"),

  getSidebarWidth: (): number => {
    const stored = readString(KEYS.sidebarWidth);
    return stored === null ? SIDEBAR_WIDTH_DEFAULT : clampSidebarWidth(Number(stored));
  },
  setSidebarWidth: (width: number): void => writeString(KEYS.sidebarWidth, String(clampSidebarWidth(width))),

  getProjectOpenOverrides: (): Record<string, boolean> => ({
    ...legacyClosedAsOverrides(readJson(KEYS.closedProjects, isStringArray) ?? []),
    ...(readJson(KEYS.projectOpenOverrides, isBooleanRecord) ?? {}),
  }),
  setProjectOpenOverrides: (overrides: Readonly<Record<string, boolean>>): void =>
    writeString(KEYS.projectOpenOverrides, JSON.stringify(overrides)),

  getCollapsedThreads: (): string[] => readJson(KEYS.collapsedThreads, isStringArray) ?? [],
  setCollapsedThreads: (ids: readonly string[]): void =>
    writeString(KEYS.collapsedThreads, JSON.stringify(ids)),

  getTheme: (): Theme => {
    const stored = readString(KEYS.theme);
    return isTheme(stored) ? stored : "system";
  },
  setTheme: (theme: Theme): void => {
    writeString(KEYS.theme, theme);
    for (const listener of themeListeners) listener();
  },
  subscribeTheme: (listener: () => void): (() => void) => {
    themeListeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEYS.theme) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      themeListeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },

  getLastProjectId: (): string | null => readString(KEYS.lastProject),
  setLastProjectId: (id: string): void => writeString(KEYS.lastProject, id),

  getLastModel: (): ModelRef | null => readJson(KEYS.lastModel, isModelRef),
  setLastModel: (ref: ModelRef): void => writeString(KEYS.lastModel, JSON.stringify(ref)),

  getLastThinkingLevel: (): ThinkingLevel | null =>
    readString(KEYS.lastThinkingLevel) as ThinkingLevel | null,
  setLastThinkingLevel: (level: ThinkingLevel): void => writeString(KEYS.lastThinkingLevel, level),

  getNotificationsEnabled: (): boolean => readString(KEYS.notifications) === "on",
  setNotificationsEnabled: (enabled: boolean): void =>
    writeString(KEYS.notifications, enabled ? "on" : "off"),

  getLastSeenAt: (conversationId: string): number | null =>
    readJson(KEYS.lastSeenAt, isNumberRecord)?.[conversationId] ?? null,
  setLastSeenAt: (conversationId: string, at: number): void =>
    writeString(
      KEYS.lastSeenAt,
      JSON.stringify({ ...readJson(KEYS.lastSeenAt, isNumberRecord), [conversationId]: at }),
    ),

  /** Set on first load: a thread without `lastSeenAt` counts as seen up to this time. */
  getSeenBaseline: (now: number): number => {
    const stored = Number(readString(KEYS.seenBaseline));
    if (Number.isFinite(stored) && stored > 0) return stored;
    writeString(KEYS.seenBaseline, String(now));
    return now;
  },
};
