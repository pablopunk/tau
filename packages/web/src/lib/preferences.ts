import type { ModelRef, ThinkingLevel } from "@tau/protocol";
import { machineKey } from "./machine-keys";
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
  collapsedMachines: "tau-sidebar-collapsed-machines",
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

  getProjectOpenOverrides: (machineId?: string): Record<string, boolean> => ({
    ...legacyClosedAsOverrides(readJson(machineKey(KEYS.closedProjects, machineId), isStringArray) ?? []),
    ...(readJson(machineKey(KEYS.projectOpenOverrides, machineId), isBooleanRecord) ?? {}),
  }),
  setProjectOpenOverrides: (overrides: Readonly<Record<string, boolean>>, machineId?: string): void =>
    writeString(machineKey(KEYS.projectOpenOverrides, machineId), JSON.stringify(overrides)),

  getCollapsedThreads: (machineId?: string): string[] =>
    readJson(machineKey(KEYS.collapsedThreads, machineId), isStringArray) ?? [],
  setCollapsedThreads: (ids: readonly string[], machineId?: string): void =>
    writeString(machineKey(KEYS.collapsedThreads, machineId), JSON.stringify(ids)),

  getCollapsedMachines: (): string[] => readJson(KEYS.collapsedMachines, isStringArray) ?? [],
  setCollapsedMachines: (ids: readonly string[]): void =>
    writeString(KEYS.collapsedMachines, JSON.stringify(ids)),

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

  getLastProjectId: (machineId?: string): string | null =>
    readString(machineKey(KEYS.lastProject, machineId)),
  setLastProjectId: (id: string, machineId?: string): void =>
    writeString(machineKey(KEYS.lastProject, machineId), id),

  getLastModel: (machineId?: string): ModelRef | null =>
    readJson(machineKey(KEYS.lastModel, machineId), isModelRef),
  setLastModel: (ref: ModelRef, machineId?: string): void =>
    writeString(machineKey(KEYS.lastModel, machineId), JSON.stringify(ref)),

  getLastThinkingLevel: (machineId?: string): ThinkingLevel | null =>
    readString(machineKey(KEYS.lastThinkingLevel, machineId)) as ThinkingLevel | null,
  setLastThinkingLevel: (level: ThinkingLevel, machineId?: string): void =>
    writeString(machineKey(KEYS.lastThinkingLevel, machineId), level),

  getNotificationsEnabled: (): boolean => readString(KEYS.notifications) === "on",
  setNotificationsEnabled: (enabled: boolean): void =>
    writeString(KEYS.notifications, enabled ? "on" : "off"),

  getLastSeenAt: (conversationId: string, machineId?: string): number | null =>
    readJson(machineKey(KEYS.lastSeenAt, machineId), isNumberRecord)?.[conversationId] ?? null,
  setLastSeenAt: (conversationId: string, at: number, machineId?: string): void => {
    const key = machineKey(KEYS.lastSeenAt, machineId);
    writeString(key, JSON.stringify({ ...readJson(key, isNumberRecord), [conversationId]: at }));
  },

  /** Set on first load: a thread without `lastSeenAt` counts as seen up to this time. */
  getSeenBaseline: (now: number, machineId?: string): number => {
    const key = machineKey(KEYS.seenBaseline, machineId);
    const stored = Number(readString(key));
    if (Number.isFinite(stored) && stored > 0) return stored;
    writeString(key, String(now));
    return now;
  },
};
