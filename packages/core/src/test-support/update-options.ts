/** Core options for tests that do not care about updates: the registry is never reachable. */
export const NO_UPDATE_OPTIONS = {
  currentVersion: "0.0.0-test",
  latestVersion: (): Promise<string> => Promise.reject(new Error("offline")),
} as const;
