import type { Change } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { createFakeResources } from "./fake-resources";

const COMMAND = {
  entryId: "p1",
  conversationId: "c1",
  conversationTitle: "T",
  command: "pnpm test",
  since: 1,
};

describe("fake resources: cross-thread stop", () => {
  it("stops a seeded holder from any caller and announces a node-wide change", async () => {
    const changes: Change[] = [];
    const resources = createFakeResources({ emit: (change) => changes.push(change) });
    resources.seed({ holders: [COMMAND], waiting: [{ ...COMMAND, entryId: "p2", conversationId: "c2" }] });
    await resources.api.stopResourceCommand("p2");
    expect(await resources.api.resourceActivity()).toEqual({ holders: [COMMAND], waiting: [] });
    expect(changes.at(-1)).toEqual({ resource: "resources" });
    await expect(resources.api.stopResourceCommand("p2")).rejects.toMatchObject({ code: "not_found" });
  });
});
