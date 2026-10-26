import {
  AppError,
  type Change,
  type Core,
  DEFAULT_RESOURCE_SETTINGS,
  type ResourceActivity,
  type ResourceCommand,
  type ResourceSettings,
  ResourceSettingsSchema,
  type ResourceSupport,
} from "@tau/protocol";
import { Value } from "typebox/value";

export const FAKE_RESOURCE_SUPPORT: ResourceSupport = {
  platform: "linux",
  memoryEnforcement: "polled",
  prioritySupported: true,
  sameCgroupOnly: true,
  note: null,
  sandbox: { enforced: true, mechanism: "systemd", tested: true, note: null },
};

export interface FakeResources {
  readonly settings: () => ResourceSettings;
  readonly api: Pick<
    Core["settings"],
    "setResources" | "resourceSupport" | "resourceActivity" | "stopResourceCommand"
  >;
  /** Puts commands into the activity list, as the real governor does on queue and grant. */
  seed(activity: { holders?: ResourceCommand[]; waiting?: ResourceCommand[] }): void;
}

const copy = (value: ResourceSettings): ResourceSettings => ({ ...value, levels: { ...value.levels } });

export function createFakeResources(ctx: { emit: (change: Change) => void }): FakeResources {
  let settings = copy(DEFAULT_RESOURCE_SETTINGS);
  let holders: ResourceCommand[] = [];
  let waiting: ResourceCommand[] = [];
  const announce = () => ctx.emit({ resource: "resources" });
  return {
    settings: () => copy(settings),
    api: {
      async setResources(value) {
        if (!Value.Check(ResourceSettingsSchema, value)) {
          throw new AppError("invalid_request", "Each scope runs Off, Balanced or Background.");
        }
        settings = copy(value);
        announce();
      },
      async resourceSupport() {
        return { ...FAKE_RESOURCE_SUPPORT };
      },
      async resourceActivity(): Promise<ResourceActivity> {
        return { holders: holders.map((c) => ({ ...c })), waiting: waiting.map((c) => ({ ...c })) };
      },
      async stopResourceCommand(entryId) {
        const listed = [...holders, ...waiting].some((c) => c.entryId === entryId);
        if (!listed) throw new AppError("not_found", `No resource command ${entryId}`);
        holders = holders.filter((c) => c.entryId !== entryId);
        waiting = waiting.filter((c) => c.entryId !== entryId);
        announce();
      },
    },
    seed(activity) {
      holders = [...holders, ...(activity.holders ?? [])];
      waiting = [...waiting, ...(activity.waiting ?? [])];
      announce();
    },
  };
}
