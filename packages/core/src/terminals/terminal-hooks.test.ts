import { afterEach, describe, expect, it } from "vitest";
import { createCoreWith, defaultCoreDependencies } from "../create-core";
import { type FauxWorld, openFauxWorld, setUpConversation } from "../test-support/faux-core";
import { useTempDir } from "../test-support/temp-dir";
import { createFakeTerminalDaemon } from "./fake-terminal-daemon";
import type { TerminalService } from "./terminal-service";

const tempDir = useTempDir();
const worlds: FauxWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.core.close();
});

function recordingService(log: string[], archivedAtCall?: (id: string) => Promise<boolean>) {
  const service: TerminalService = {
    api: {
      available: async () => false,
      list: async () => [],
      open: async () => Promise.reject(new Error("unused")),
      close: async () => undefined,
      attach: async () => Promise.reject(new Error("unused")),
    },
    closeAllOf: async (id) => {
      log.push(`closeAllOf:${id}:${archivedAtCall ? await archivedAtCall(id) : ""}`);
    },
    onConversationRemoved: async (thread) => {
      log.push(`removed:${thread.id}`);
    },
    close: async () => {
      log.push("close");
    },
  };
  return service;
}

async function openWorld() {
  const root = await tempDir();
  const log: string[] = [];
  let world: FauxWorld | undefined;
  const isArchived = async (id: string) => {
    const projects = await world?.core.projects.list();
    for (const project of projects ?? []) {
      const found = (await world?.core.conversations.list(project.id))?.find((thread) => thread.id === id);
      if (found) return found.archivedAt !== null;
    }
    return false;
  };
  const dependencies = {
    ...defaultCoreDependencies(),
    terminalDaemon: createFakeTerminalDaemon(),
    terminalService: () => recordingService(log, isArchived),
  };
  const opened = await openFauxWorld(root, Date.now, process.env, async (home) =>
    createCoreWith({ home, faux: true }, dependencies),
  );
  world = opened;
  worlds.push(world);
  return { world, log };
}

describe("terminal seams", () => {
  it("closes terminals before the archive lands, for the thread", async () => {
    const { world, log } = await openWorld();
    const { conversation } = await setUpConversation(world);
    await world.core.conversations.archive(conversation.id, true);
    expect(log).toContain(`closeAllOf:${conversation.id}:false`);
    await world.core.conversations.archive(conversation.id, false);
    expect(log.filter((entry) => entry.startsWith("closeAllOf"))).toHaveLength(1);
  });

  it("runs the terminal hook when a thread is deleted", async () => {
    const { world, log } = await openWorld();
    const { conversation } = await setUpConversation(world);
    await world.core.conversations.remove(conversation.id);
    expect(log[0]).toBe(`removed:${conversation.id}`);
  });

  it("runs the terminal hook for every thread when a project is removed, and closes the service at close", async () => {
    const { world, log } = await openWorld();
    const { conversation, project } = await setUpConversation(world);
    await world.core.projects.remove(project.id);
    expect(log).toContain(`removed:${conversation.id}`);
    await world.core.close();
    expect(log.at(-1)).toBe("close");
  });
});
