import { beforeEach, describe, expect, it } from "vitest";
import { legacyNodeIds, migrateNodeKeys, renamedKey } from "./node-key-migration";
import { nodeKey, scopeTarget } from "./node-keys";

const store = window.localStorage;
beforeEach(() => store.clear());

describe("migrateNodeKeys", () => {
  it("moves drafts, attachments, seen-baselines, last-seen, the summary cache and preferences", () => {
    const old = {
      "tau:draft:m:old:c1": "hello",
      "tau:attachments:m:old:new": "[]",
      "tau:seen-baseline:m:old": "123",
      "tau:last-seen-at:m:old": '{"c1":5}',
      "tau:node-summary:m:old": '{"projects":[],"threads":[]}',
      "tau-sidebar-project-overrides:m:old": '{"p":true}',
      "tau:new-thread-draft:m:old": "{}",
    };
    for (const [key, value] of Object.entries(old)) store.setItem(key, value);
    expect(migrateNodeKeys(store, { from: "old", to: "NODE" })).toEqual({ moved: 7, kept: 0 });
    expect(store.getItem("tau:draft:n:NODE:c1")).toBe("hello");
    expect(store.getItem("tau:attachments:n:NODE:new")).toBe("[]");
    expect(store.getItem("tau:seen-baseline:n:NODE")).toBe("123");
    expect(store.getItem("tau:last-seen-at:n:NODE")).toBe('{"c1":5}');
    expect(store.getItem("tau:node-summary:n:NODE")).toBe('{"projects":[],"threads":[]}');
    expect(store.getItem("tau-sidebar-project-overrides:n:NODE")).toBe('{"p":true}');
    expect(store.getItem("tau:new-thread-draft:n:NODE")).toBe("{}");
    for (const key of Object.keys(old)) expect(store.getItem(key)).toBeNull();
  });

  it("matches what nodeKey and scopeTarget write", () => {
    expect(nodeKey("tau:seen-baseline", "NODE")).toBe("tau:seen-baseline:n:NODE");
    expect(renamedKey(`tau:draft:${scopeTarget("c1", "old")}`, { from: "old", to: "NODE" })).toBe(
      `tau:draft:${scopeTarget("c1", "NODE")}`,
    );
  });

  it("also moves keys already under the new marker (an unidentified peer that got its nodeId)", () => {
    store.setItem("tau:draft:n:device:c1", "x");
    expect(migrateNodeKeys(store, { from: "device", to: "NODE" }).moved).toBe(1);
    expect(store.getItem("tau:draft:n:NODE:c1")).toBe("x");
  });

  it("never overwrites an existing destination and leaves the old key", () => {
    store.setItem("tau:seen-baseline:m:old", "1");
    store.setItem("tau:seen-baseline:n:NODE", "2");
    expect(migrateNodeKeys(store, { from: "old", to: "NODE" })).toEqual({ moved: 0, kept: 1 });
    expect(store.getItem("tau:seen-baseline:n:NODE")).toBe("2");
    expect(store.getItem("tau:seen-baseline:m:old")).toBe("1");
  });

  it("never touches the local node's keys, other nodes or unrelated keys", () => {
    for (const key of ["tau:seen-baseline", "tau:seen-baseline:m:other", "tau:draft:c1", "tau:theme"]) {
      store.setItem(key, "v");
    }
    expect(migrateNodeKeys(store, { from: "old", to: "NODE" })).toEqual({ moved: 0, kept: 0 });
    expect(store.length).toBe(4);
  });

  it("leaves the old key in place when the write fails (quota)", () => {
    store.setItem("tau:draft:m:old:c1", "x");
    const failing = {
      get length() {
        return store.length;
      },
      key: (index: number) => store.key(index),
      getItem: (key: string) => store.getItem(key),
      removeItem: (key: string) => store.removeItem(key),
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    } as unknown as Storage;
    expect(migrateNodeKeys(failing, { from: "old", to: "NODE" })).toEqual({ moved: 0, kept: 1 });
    expect(store.getItem("tau:draft:m:old:c1")).toBe("x");
  });

  it("lists the ids that still have 0.1.x keys", () => {
    store.setItem("tau:draft:m:a:c1", "x");
    store.setItem("tau:seen-baseline:m:b", "1");
    store.setItem("tau:seen-baseline:n:c", "1");
    expect(legacyNodeIds(store).sort()).toEqual(["a", "b"]);
  });
});
