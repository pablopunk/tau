import { createFakeCore, type FakeCore, type FakeCoreOptions } from "./fake-core";
import { createFakeGroupBus, type FakeGroupBus } from "./fake-group-bus";
import { linkFakeCores } from "./link-fake-cores";

export interface FakeGroup {
  /** A and B are linked, B and C are linked; A and C only know each other through B (2 hops). */
  readonly a: FakeCore;
  readonly b: FakeCore;
  readonly c: FakeCore;
  readonly ids: { readonly a: string; readonly b: string; readonly c: string };
  readonly bus: FakeGroupBus;
  /** The node can no longer be reached by an expel (a cut vertex or an offline node) until `reconnect`. */
  cut(core: FakeCore): void;
  reconnect(core: FakeCore): void;
  dispose(): Promise<void>;
}

/** The executable spec of a Step 2 group: the three-node chain A-B-C with C reachable only via B. */
export async function createFakeGroup(options: FakeCoreOptions = {}): Promise<FakeGroup> {
  const make = (name: string, os: string) =>
    createFakeCore({ ...options, configured: true, nodeName: name, nodeOs: os });
  const a = make("Alpha", "darwin arm64");
  const b = make("Bravo", "linux x64");
  const c = make("Charlie", "win32 x64");
  await linkFakeCores(a, b);
  await linkFakeCores(b, c);
  await a.nodesControl.reach(c, b, 2);
  await c.nodesControl.reach(a, b, 2);
  const bus = createFakeGroupBus();
  for (const core of [a, b, c]) core.nodesControl.joinGroup(bus);
  const idOf = (core: FakeCore) => core.nodesControl.nodeId();
  return {
    a,
    b,
    c,
    ids: { a: idOf(a), b: idOf(b), c: idOf(c) },
    bus,
    cut: (core) => bus.cut(idOf(core)),
    reconnect: (core) => bus.reconnect(idOf(core)),
    dispose: async () => {
      for (const core of [a, b, c]) await core.close();
    },
  };
}
