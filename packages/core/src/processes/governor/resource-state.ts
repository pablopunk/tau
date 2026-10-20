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

export const anyControlOn = (settings: ResourceSettings) =>
  settings.priority !== "off" || settings.heavySlots !== null || settings.memoryLimitMb !== null;
