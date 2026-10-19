import { describe, expect, it } from "vitest";
import { createFakeCore } from "./fake-core";
import { linkFakeCores } from "./link-fake-cores";

describe("linkFakeCores: two directions", () => {
  it("A sees B and B sees A, with opposite directions", async () => {
    const a = createFakeCore({ nodeName: "A", configured: true });
    const b = createFakeCore({ nodeName: "B", configured: true });
    await linkFakeCores(a, b);
    const [listA, listB] = [await a.nodes.list(), await b.nodes.list()];
    expect(listA).toMatchObject([{ id: b.nodesControl.nodeId(), name: "B", identified: true }]);
    expect(listB).toMatchObject([{ id: a.nodesControl.nodeId(), name: "A", identified: true }]);
    expect(listA[0]?.links[0]?.direction).toBe("dialled");
    expect(listB[0]?.links[0]?.direction).toBe("accepted");
  });

  it("reaches the other side's data from both ends", async () => {
    const a = createFakeCore({ nodeName: "A", configured: true });
    const b = createFakeCore({ nodeName: "B", configured: true });
    await linkFakeCores(a, b);
    expect(a.nodeCores.get(b.nodesControl.nodeId())).toBe(b);
    expect(b.nodeCores.get(a.nodesControl.nodeId())).toBe(a);
  });

  it("forget on one side leaves the other side's list alone", async () => {
    const a = createFakeCore({ nodeName: "A", configured: true });
    const b = createFakeCore({ nodeName: "B", configured: true });
    await linkFakeCores(a, b);
    await a.nodes.forget(b.nodesControl.nodeId());
    expect(await a.nodes.list()).toEqual([]);
    expect(await b.nodes.list()).toHaveLength(1);
  });

  it("seeds a group with `nodes: true` where each seed also sees the hub", async () => {
    const hub = createFakeCore({ nodes: true, configured: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await hub.nodes.list()).map((node) => node.name).sort()).toEqual(["Homelab", "Work laptop"]);
    for (const peer of hub.nodeCores.values()) {
      expect((await peer.nodes.list()).map((node) => node.id)).toEqual([hub.nodesControl.nodeId()]);
    }
  });
});
