import { join } from "node:path";
import type { Harness } from "@earendil-works/pi-durable";
import { processToolServices } from "../test-support/process-tool-services";
import { createFauxSetup, type FauxSetup } from "../testing/faux-provider";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./open";
import { createAgentRegistry } from "./registry";

export interface RuntimeWorld {
  readonly harness: Harness;
  readonly setup: FauxSetup;
  readonly directory: string;
  close(): Promise<void>;
}

/** Opens a harness over `agent.sqlite` in `directory`; pass an earlier world's `setup` so model calls span a restart. */
export async function openRuntimeWorld(directory: string, setup?: FauxSetup): Promise<RuntimeWorld> {
  const faux = setup ?? createFauxSetup();
  const harness = await openAgentHarness({
    storage: await openSqliteStorage(join(directory, "agent.sqlite")),
    models: faux.models,
    registry: createAgentRegistry(processToolServices(directory)),
  });
  return { harness, setup: faux, directory, close: () => harness.close(BACKGROUND) };
}

/** A bare ownerless conversation: Pi has no model, no input and no task for it. */
export async function createPassiveThread(world: RuntimeWorld): Promise<string> {
  const conversation = await world.harness.createConversation(
    { ownership: { kind: "ownerless" }, agent: { cwd: world.directory } },
    BACKGROUND,
  );
  return String(conversation.id);
}

export const modelCallsOf = (setup: FauxSetup): number => setup.faux.state.callCount;
