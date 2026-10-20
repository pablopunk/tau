import { DEFAULT_RESOURCE_SETTINGS, type ResourceSettings } from "@tau/protocol";

/** The node's resource settings in memory: read synchronously by the process service, replaced by `setResources`. */
export interface ResourceState {
  get(): ResourceSettings;
  set(next: ResourceSettings): void;
}

export function createResourceState(initial: ResourceSettings = DEFAULT_RESOURCE_SETTINGS): ResourceState {
  let current = initial;
  return {
    get: () => current,
    set(next) {
      current = next;
    },
  };
}

/** Any scope above Off: slots and the memory cap cover every governed scope. */
export const anyControlOn = (settings: ResourceSettings) =>
  settings.levels.main !== "off" || settings.levels.worktree !== "off" || settings.levels.subagent !== "off";
