import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import {
  Harness,
  type HarnessOptions,
  type HarnessSettings,
  type RegistryReader,
  type Storage,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createAgentRegistry } from "./registry";

export const BACKGROUND = BACKGROUND_CONTEXT;

export interface OpenAgentHarnessOptions {
  readonly storage: Storage;
  readonly models: Models;
  readonly registry?: RegistryReader;
  readonly env?: HarnessOptions["env"];
  readonly settings?: HarnessSettings;
  readonly onReport?: (error: unknown) => void;
  /** Awaited after the Harness opens and before `resume()`, so listeners see every commit resume makes. */
  readonly beforeResume?: (harness: Harness) => void | Promise<void>;
}

export const projectEnv: NonNullable<HarnessOptions["env"]> = ({ cwd }) =>
  new NodeExecutionEnv({ cwd: cwd ?? process.cwd() });

export function openSqliteStorage(path: string): Promise<Storage> {
  return openNodeSqliteStorage(path);
}

/** The only place a Harness is opened: the real core and the fixture recorder both use it. */
export async function openAgentHarness(options: OpenAgentHarnessOptions): Promise<Harness> {
  const harness = await Harness.open(
    options.storage,
    {
      models: options.models,
      registry: options.registry ?? createAgentRegistry(),
      env: options.env ?? projectEnv,
      settings: options.settings,
      onReport: options.onReport,
    },
    BACKGROUND,
  );
  await options.beforeResume?.(harness);
  harness.resume();
  return harness;
}
