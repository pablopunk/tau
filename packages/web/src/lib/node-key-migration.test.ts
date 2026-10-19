import { describe, expect, it } from "vitest";
import { migrateNodeKeys } from "./node-key-migration";

describe("node key migration (seam; owner C implements)", () => {
  it("is a no-op stub that touches no key", () => {
    window.localStorage.setItem("summary-cache:m:old", "{}");
    expect(migrateNodeKeys(window.localStorage, { from: "old", to: "new" })).toEqual({ moved: 0, kept: 0 });
    expect(window.localStorage.getItem("summary-cache:m:old")).toBe("{}");
    window.localStorage.clear();
  });

  it.todo("moves drafts, seen-baselines, the summary cache and preferences from the old id to the nodeId");
  it.todo("never overwrites a destination key and never touches the local node's keys");
  it.todo("runs once per node: a second call moves nothing");
});
