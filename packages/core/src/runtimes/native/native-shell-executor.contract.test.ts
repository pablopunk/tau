import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeLifecycle } from "@tau/protocol";
import {
  type AdmitRequest,
  type CancelRequest,
  type RuntimeContractTarget,
  type RuntimeExecutorUnderTest,
  runRuntimeContract,
} from "@tau/testkit/runtime-contract";
import { afterAll, describe, expect, it } from "vitest";
import { createRuntimeStore, type RuntimeStore } from "../../harness/runtime-store";
import {
  createPassiveThread,
  modelCallsOf,
  openRuntimeWorld,
  type RuntimeWorld,
} from "../../harness/runtime-store-fixture";
import { createFauxSetup } from "../../testing/faux-provider";
import { createNativeShellExecutor, type NativeShellExecutor } from "./native-shell-executor";

const setup = createFauxSetup();
const directories: string[] = [];
const worlds: RuntimeWorld[] = [];

type Opened = {
  world: RuntimeWorld;
  threadId: string;
  store: RuntimeStore;
  executor: NativeShellExecutor;
};

type Handle = { opened: Promise<Opened> };

const handles = new WeakMap<RuntimeExecutorUnderTest, Handle>();

async function freshDirectory(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "tau-native-shell-")));
  directories.push(directory);
  return directory;
}

async function openThread(directory: string, existing?: string): Promise<Opened> {
  const world = await openRuntimeWorld(directory, setup);
  worlds.push(world);
  const threadId = existing ?? (await createPassiveThread(world));
  const store = createRuntimeStore(world.harness, threadId);
  return { world, threadId, store, executor: createNativeShellExecutor(store) };
}

function lazyExecutor(handle: Handle): RuntimeExecutorUnderTest {
  const onThread = async <T>(use: (opened: Opened) => Promise<T> | T): Promise<T> => use(await handle.opened);
  const executor: RuntimeExecutorUnderTest = {
    executor: "claude-code",
    admit: (req: AdmitRequest) =>
      onThread((opened) => opened.executor.admit({ ...req, threadId: opened.threadId })),
    inspect: () => onThread((opened) => opened.executor.inspect(opened.threadId)),
    observe: (_threadId, from) => {
      async function* frames() {
        const opened = await handle.opened;
        yield* opened.executor.observe(opened.threadId, from);
      }
      return frames();
    },
    cancel: (req: CancelRequest) =>
      onThread((opened) => opened.executor.cancel({ ...req, threadId: opened.threadId })),
    reconcile: (_threadId, epoch) => onThread((opened) => opened.executor.reconcile(opened.threadId, epoch)),
    capabilities: () => onThread((opened) => opened.executor.capabilities(opened.threadId)),
  };
  handles.set(executor, handle);
  return executor;
}

function handleOf(executor: RuntimeExecutorUnderTest): Handle {
  const handle = handles.get(executor);
  if (!handle) throw new Error("Executor was not made by this target");
  return handle;
}

const target: RuntimeContractTarget = {
  expectedExecutor: "claude-code",
  makeExecutor: () => {
    const opened = freshDirectory().then((directory) => openThread(directory));
    return lazyExecutor({ opened });
  },
  restart: async (executor) => {
    const previous = await handleOf(executor).opened;
    await previous.world.close();
    const opened = openThread(previous.world.directory, previous.threadId);
    return lazyExecutor({ opened });
  },
  settle: async (executor) => (await handleOf(executor).opened).executor.settle(),
  bumpEpoch: async (executor) => {
    await (await handleOf(executor).opened).executor.bumpEpoch();
  },
};

afterAll(async () => {
  await Promise.all(worlds.map((world) => world.close().catch(() => undefined)));
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
});

runRuntimeContract("native shell executor over a passive container", target);

describe("native shell executor beyond the contract", () => {
  it("made zero Pi model calls across the whole contract run", () => {
    expect(modelCallsOf(setup)).toBe(0);
    expect(setup.faux.getPendingResponseCount()).toBeGreaterThan(0);
  });
});

async function reconcileAfterRestart(lifecycle: readonly RuntimeLifecycle[]) {
  const directory = await freshDirectory();
  const first = await openThread(directory);
  await first.executor.admit({ threadId: first.threadId, requestId: "r1", payload: payloadOf() });
  for (const step of lifecycle) await first.store.setLifecycle(step);
  await first.world.close();
  const second = await openThread(directory, first.threadId);
  return { second, epoch: (await second.executor.inspect(second.threadId)).cursor.epoch };
}

const payloadOf = () => ({
  text: "hello",
  attachmentIds: [],
  origin: "user" as const,
  delivery: "queue" as const,
});

describe("native shell executor reconcile after a real restart", () => {
  it("never reports settled for a lifecycle that was running or starting", async () => {
    for (const path of [
      ["preparing", "ready", "starting"],
      ["preparing", "ready", "starting", "running"],
    ] as const) {
      const { second, epoch } = await reconcileAfterRestart(path);
      expect(await second.executor.reconcile(second.threadId, epoch)).toBe("outcome-unknown");
      expect((await second.executor.inspect(second.threadId)).writer).toBe("unknown");
    }
  });

  it("settles a thread that only queued input and interrupts a stale epoch", async () => {
    const { second, epoch } = await reconcileAfterRestart([]);
    expect(await second.executor.reconcile(second.threadId, epoch)).toBe("settled");
    await second.executor.bumpEpoch();
    expect(await second.executor.reconcile(second.threadId, epoch)).toBe("interrupted");
  });

  it("reports interrupted for an interrupted lifecycle", async () => {
    const path = ["preparing", "ready", "starting", "running", "cancelling", "interrupted"];
    const { second, epoch } = await reconcileAfterRestart(path as RuntimeLifecycle[]);
    expect(await second.executor.reconcile(second.threadId, epoch)).toBe("interrupted");
  });

  it("rejects a thread it does not serve", async () => {
    const { second } = await reconcileAfterRestart([]);
    await expect(second.executor.inspect("other-thread")).rejects.toMatchObject({ code: "invalid_request" });
  });
});
