import type { Node } from "@tau/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { reconcileNodeIds, resolveLegacyNodeId } from "./node-id-reconcile";

const store = window.localStorage;
beforeEach(() => store.clear());

const node = (overrides: Partial<Node>): Node => ({
  id: "n1",
  identified: true,
  name: "Homelab",
  os: "linux",
  tauVersion: "0.2.0",
  protocolVersion: "p",
  status: "online",
  lastSeenAt: 0,
  threadCount: 0,
  links: [],
  ...overrides,
});

describe("reconcileNodeIds", () => {
  it("keeps an unidentified peer's data readable under the new marker, with the same id", () => {
    store.setItem("tau:draft:m:dev1:c1", "draft");
    reconcileNodeIds(store, [node({ id: "dev1", identified: false })]);
    expect(store.getItem("tau:draft:n:dev1:c1")).toBe("draft");
  });

  it("moves the keys to the nodeId at the first hello and remembers old -> new", () => {
    const pending = node({ id: "dev1", identified: false });
    reconcileNodeIds(store, [pending]);
    store.setItem("tau:seen-baseline:n:dev1", "50");
    store.setItem("tau:draft:n:dev1:c1", "draft");
    store.setItem("tau:node-summary:n:dev1", "{}");
    const moved = reconcileNodeIds(store, [node({ id: "NODEID" })]);
    expect(moved).toEqual({ dev1: "NODEID" });
    expect(store.getItem("tau:seen-baseline:n:NODEID")).toBe("50");
    expect(store.getItem("tau:draft:n:NODEID:c1")).toBe("draft");
    expect(store.getItem("tau:node-summary:n:NODEID")).toBe("{}");
    expect(store.getItem("tau:seen-baseline:n:dev1")).toBeNull();
    expect(reconcileNodeIds(store, [node({ id: "NODEID" })])).toEqual({ dev1: "NODEID" });
  });

  it("does nothing for an unidentified peer beyond the marker", () => {
    store.setItem("tau:seen-baseline:n:dev1", "50");
    reconcileNodeIds(store, [node({ id: "dev1", identified: false })]);
    expect(store.getItem("tau:seen-baseline:n:dev1")).toBe("50");
  });

  it("matches one orphaned old id with one new identified node on the first run after the upgrade", () => {
    store.setItem("tau:seen-baseline:m:dev1", "50");
    reconcileNodeIds(store, [node({ id: "NODEID" })]);
    expect(store.getItem("tau:seen-baseline:n:NODEID")).toBe("50");
  });

  it("does not guess when two old ids could match", () => {
    store.setItem("tau:seen-baseline:m:dev1", "1");
    store.setItem("tau:seen-baseline:m:dev2", "2");
    reconcileNodeIds(store, [node({ id: "NODEID" })]);
    expect(store.getItem("tau:seen-baseline:n:NODEID")).toBeNull();
    expect(store.getItem("tau:seen-baseline:m:dev1")).toBe("1");
  });

  it("never touches the local node's keys", () => {
    store.setItem("tau:seen-baseline", "9");
    reconcileNodeIds(store, [node({ id: "NODEID" })]);
    expect(store.getItem("tau:seen-baseline")).toBe("9");
  });
});

describe("resolveLegacyNodeId", () => {
  it("resolves an old id through the recorded move, else the same id", () => {
    reconcileNodeIds(store, [node({ id: "dev1", identified: false })]);
    const list = [node({ id: "NODEID" })];
    expect(resolveLegacyNodeId(store, "dev1", list)).toBe("NODEID");
    expect(resolveLegacyNodeId(store, "unknown", list)).toBe("unknown");
    expect(resolveLegacyNodeId(store, "NODEID", list)).toBe("NODEID");
  });
});
