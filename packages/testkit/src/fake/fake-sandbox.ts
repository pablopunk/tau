import {
  AppError,
  type Change,
  type Core,
  DEFAULT_SANDBOX_SETTINGS,
  type SandboxSettings,
  SandboxSettingsSchema,
} from "@tau/protocol";
import { Value } from "typebox/value";

export interface FakeSandbox {
  readonly settings: () => SandboxSettings;
  readonly api: Pick<Core["settings"], "setSandbox">;
}

const copy = (value: SandboxSettings): SandboxSettings => ({
  ...value,
  ...(value.mcpAllowlist === undefined ? {} : { mcpAllowlist: [...value.mcpAllowlist] }),
});

export function createFakeSandbox(ctx: { emit: (change: Change) => void }): FakeSandbox {
  let settings = copy(DEFAULT_SANDBOX_SETTINGS);
  return {
    settings: () => copy(settings),
    api: {
      async setSandbox(value) {
        if (!Value.Check(SandboxSettingsSchema, value)) {
          throw new AppError("invalid_request", "Each sandbox scope is on or off.");
        }
        settings = copy(value);
        ctx.emit({ resource: "resources" });
      },
    },
  };
}
