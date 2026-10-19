import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode } from "./helpers";
import type { ContractGroup, MakeContractTarget } from "./types";

const requireGroup = async (
  make: MakeContractTarget,
): Promise<{ group: ContractGroup; dispose(): Promise<void> }> => {
  const target = await make();
  const group = await (target.group as NonNullable<typeof target.group>)();
  return { group, dispose: async () => (await group.dispose(), target.dispose()) };
};

/** `[nodes-group]` cases: routed nodes, "via", typed-confirmation expel, confirmations. */
export function nodesGroupCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("nodes group", () => {
    let group: ContractGroup;
    let dispose: () => Promise<void>;
    beforeEach(async () => {
      ({ group, dispose } = await requireGroup(make));
    });
    afterEach(() => dispose());

    test("[nodes-group] a node behind a neighbour is listed with hops 2 and 'via' the neighbour's name", async () => {
      const directory = await group.a.nodes.directory();
      const b = directory.find((node) => node.id === group.ids.b);
      const c = directory.find((node) => node.id === group.ids.c);
      expect(b).toMatchObject({ direct: true, hops: 1, via: null, nextHop: group.ids.b });
      expect(b?.links.length).toBeGreaterThan(0);
      expect(c).toMatchObject({ direct: false, hops: 2, via: b?.name, nextHop: group.ids.b, links: [] });
      expect(group.a.nodes.group.route(group.ids.c)).toEqual({
        dest: group.ids.c,
        nextHop: group.ids.b,
        hops: 2,
      });
    });

    test("[nodes-group] the middle node sees both ends as neighbours", async () => {
      const directory = await group.b.nodes.directory();
      expect(directory.map((node) => [node.id, node.hops]).sort()).toEqual(
        [
          [group.ids.a, 1],
          [group.ids.c, 1],
        ].sort(),
      );
    });

    test("[nodes-group] remove needs the node's name or id typed exactly, and refuses self", async () => {
      await rejectsWithCode(group.a.nodes.group.createExpel(group.ids.c, "nope"), "confirmation_mismatch");
      await rejectsWithCode(group.a.nodes.group.createExpel(group.ids.a, "Alpha"), "cannot_remove_self");
      expect(await group.a.nodes.expulsions()).toEqual([]);
    });

    test("[nodes-group] an expel reaches every node, is listed with by and confirmations, and quarantines the target", async () => {
      const frame = await group.a.nodes.group.createExpel(group.ids.c, "Charlie");
      expect(frame.type).toBe("expel");
      const [expulsion] = await group.a.nodes.expulsions();
      expect(expulsion).toMatchObject({ target: group.ids.c, by: group.ids.a, byName: "Alpha", pending: [] });
      expect(expulsion?.confirmations.map((entry) => entry.node).sort()).toEqual(
        [group.ids.a, group.ids.b].sort(),
      );
      expect((await group.a.nodes.directory()).map((node) => node.id)).toEqual([group.ids.b]);
      expect((await group.b.nodes.directory()).map((node) => node.id)).toEqual([group.ids.a]);
      expect(group.b.nodes.group.isTombstoned(group.ids.c)).toBe(true);
      expect((await group.c.nodes.self()).removed).toMatchObject({ by: group.ids.a });
      expect(await group.c.nodes.directory()).toEqual([]);
    });

    test("[nodes-group] a node the expel could not reach stays 'not confirmed' until it reconnects", async () => {
      group.cut("b");
      await group.a.nodes.group.createExpel(group.ids.c, group.ids.c);
      const [expulsion] = await group.a.nodes.expulsions();
      expect(expulsion?.pending.map((entry) => entry.node)).toEqual([group.ids.b]);
      await group.reconnect("b");
      expect((await group.a.nodes.expulsions())[0]?.pending).toEqual([]);
    });

    test("[nodes-group] reset-identity lifts the removed state with a new nodeId", async () => {
      await group.a.nodes.group.createExpel(group.ids.c, "Charlie");
      const before = (await group.c.nodes.self()).nodeId;
      await group.c.nodes.resetIdentity();
      const after = await group.c.nodes.self();
      expect(after.nodeId).not.toBe(before);
      expect(after.removed).toBeUndefined();
    });
  });
}
