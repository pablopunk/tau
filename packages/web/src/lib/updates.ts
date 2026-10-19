import type { UpdateJob, UpdateStatus } from "@tau/protocol";

export const UPDATED_KEY = "tau.updated";
export const RESTART_GIVE_UP_MS = 90_000;

export const isJobActive = (job: UpdateJob): boolean =>
  job.state === "installing" || job.state === "restarting";

/** The button shows for the owner when an install is possible and behind, or while a job is active or failed. */
export function showsUpdateButton(status: UpdateStatus | undefined): status is UpdateStatus {
  if (!status?.canUpdate) return false;
  if (isJobActive(status.job) || status.job.state === "failed") return true;
  return status.behind && status.install.mode !== "none";
}

/** Held in memory only: a reload starts a fresh page that records the new version as its baseline. */
let loadedVersion: string | undefined;
let startedHere = false;

export const resetUpdateMemory = (): void => {
  loadedVersion = undefined;
  startedHere = false;
};

export const markUpdateStartedHere = (): void => {
  startedHere = true;
};

/** True once, when a status reports a version other than the one this page loaded with. */
export function versionChanged(current: string): boolean {
  loadedVersion ??= current;
  return loadedVersion !== current;
}

export function rememberUpdateForToast(status: UpdateStatus, storage: Storage = window.sessionStorage): void {
  if (startedHere) storage.setItem(UPDATED_KEY, status.job.target ?? status.current);
}

/** The version to announce after a reload, read once. */
export function takeUpdatedVersion(storage: Storage = window.sessionStorage): string | null {
  const version = storage.getItem(UPDATED_KEY);
  if (version !== null) storage.removeItem(UPDATED_KEY);
  return version;
}
