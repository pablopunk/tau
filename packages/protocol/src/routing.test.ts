import { describe, expect, it } from "vitest";
import { clampTtl, computeRoutes, type DirectoryRecord, forwardTtl, loopsBack } from "./routing";

const rec = (origin: string, ...neighbours: string[]): DirectoryRecord => ({
  origin,
  neighbours,
  live: true,
});

describe("computeRoutes (pin r2: triangle and 16-node chain)", () => {
  it("routes C through B in a chain A-B-C with two hops", () => {
    const table = computeRoutes({ self: "a", links: ["b"], records: [rec("b", "a", "c"), rec("c", "b")] });
    expect(table.routes.get("b")).toEqual({ dest: "b", nextHop: "b", hops: 1 });
    expect(table.routes.get("c")).toEqual({ dest: "c", nextHop: "b", hops: 2 });
  });

  it("counts an edge only when both ends list each other", () => {
    const table = computeRoutes({ self: "a", links: ["b"], records: [rec("b", "a"), rec("c", "b")] });
    expect(table.routes.has("c")).toBe(false);
    const oneSided = computeRoutes({ self: "a", links: ["b"], records: [rec("b", "a", "c"), rec("c")] });
    expect(oneSided.routes.has("c")).toBe(false);
  });

  it("a neighbour that does not list us has no edge to us", () => {
    expect(computeRoutes({ self: "a", links: ["b"], records: [rec("b")] }).routes.size).toBe(0);
  });

  it("breaks ties by the lowest nodeId of the next hop", () => {
    const records = [rec("b", "a", "d"), rec("c", "a", "d"), rec("d", "b", "c")];
    expect(computeRoutes({ self: "a", links: ["c", "b"], records }).routes.get("d")?.nextHop).toBe("b");
    const reversed = [rec("d", "b", "c"), rec("c", "a", "d"), rec("b", "a", "d")];
    expect(computeRoutes({ self: "a", links: ["b", "c"], records: reversed }).routes.get("d")?.nextHop).toBe(
      "b",
    );
  });

  it("prefers fewer hops over a lower id", () => {
    const records = [rec("b", "a", "x"), rec("x", "b", "z"), rec("z", "x", "a"), rec("a2")];
    const table = computeRoutes({ self: "a", links: ["b", "z"], records });
    expect(table.routes.get("x")).toMatchObject({ hops: 2 });
    expect(table.routes.get("z")).toMatchObject({ hops: 1, nextHop: "z" });
  });

  it("drops a live edge at once when the link closes and keeps the second path", () => {
    const records = [rec("b", "a", "c"), rec("c", "a", "b")];
    expect(computeRoutes({ self: "a", links: ["b", "c"], records }).routes.get("c")?.hops).toBe(1);
    expect(computeRoutes({ self: "a", links: ["b"], records }).routes.get("c")).toMatchObject({
      hops: 2,
      nextHop: "b",
    });
  });

  it("ignores expired records (ghosts) and tombstoned ids", () => {
    const ghost: DirectoryRecord = { origin: "c", neighbours: ["b"], live: false };
    expect(
      computeRoutes({ self: "a", links: ["b"], records: [rec("b", "a", "c"), ghost] }).routes.has("c"),
    ).toBe(false);
    const dead = computeRoutes({
      self: "a",
      links: ["b"],
      records: [rec("b", "a", "c"), rec("c", "b")],
      tombstoned: new Set(["b"]),
    });
    expect(dead.routes.size).toBe(0);
  });

  it("converges on a triangle with every node one hop away", () => {
    const records = [rec("b", "a", "c"), rec("c", "a", "b")];
    const table = computeRoutes({ self: "a", links: ["b", "c"], records });
    expect([...table.routes.values()].map((r) => r.hops)).toEqual([1, 1]);
  });

  it("routes along a 16-node chain (15 hops, the ttl budget)", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `n${String(i).padStart(2, "0")}`);
    const records = ids
      .slice(1)
      .map((id, i) => rec(id, ids[i] as string, ...(ids[i + 2] ? [ids[i + 2] as string] : [])));
    const table = computeRoutes({ self: "n00", links: ["n01"], records });
    expect(table.routes.get("n15")).toMatchObject({ hops: 15, nextHop: "n01" });
    expect(table.ignored).toEqual([]);
  });
});

describe("cap of 16 (pin r5)", () => {
  const chain = (count: number) => {
    const ids = Array.from({ length: count }, (_, i) => `n${String(i).padStart(2, "0")}`);
    const records = ids
      .slice(1)
      .map((id, i) => rec(id, ids[i] as string, ...(ids[i + 2] ? [ids[i + 2] as string] : [])));
    return { ids, records };
  };

  it("admits 16 nodes counting self and ignores the 17th live, mutually connected origin", () => {
    const { records } = chain(17);
    const table = computeRoutes({ self: "n00", links: ["n01"], records });
    expect(table.routes.size).toBe(15);
    expect(table.ignored).toEqual(["n16"]);
  });

  it("origins with free fake keys and no mutual edge never fill the cap", () => {
    const { records } = chain(3);
    const fakes = Array.from({ length: 50 }, (_, i) => rec(`fake${i}`, "n00", "n01", "n02"));
    const table = computeRoutes({ self: "n00", links: ["n01"], records: [...records, ...fakes] });
    expect([...table.routes.keys()].sort()).toEqual(["n01", "n02"]);
    expect(table.ignored).toEqual([]);
  });

  it("ghosts (expired origins) are not counted", () => {
    const { records } = chain(16);
    const ghosts = Array.from(
      { length: 5 },
      (_, i): DirectoryRecord => ({ origin: `g${i}`, neighbours: ["n00"], live: false }),
    );
    expect(computeRoutes({ self: "n00", links: ["n01"], records: [...records, ...ghosts] }).ignored).toEqual(
      [],
    );
  });
});

describe("ttl and trail (pin r2: a looping frame dies)", () => {
  it("clamps a bad ttl into [0, 16]", () => {
    expect(clampTtl(99)).toBe(16);
    expect(clampTtl(-4)).toBe(0);
    expect(clampTtl(Number.NaN)).toBe(0);
    expect(clampTtl("9")).toBe(0);
    expect(clampTtl(3.9)).toBe(3);
  });

  it("forwards ttl minus one and dies at zero", () => {
    expect(forwardTtl(16)).toBe(15);
    expect(forwardTtl(1)).toBe(0);
    expect(forwardTtl(0)).toBeUndefined();
  });

  it("refuses a frame whose trail holds our id or whose ttl is spent (no loops on a triangle)", () => {
    expect(loopsBack("a", { trail: ["c", "b", "a"], ttl: 10 })).toBe(true);
    expect(loopsBack("a", { trail: ["c"], ttl: 0 })).toBe(true);
    expect(loopsBack("a", { trail: ["c"], ttl: 5 })).toBe(false);
    expect(loopsBack("a", {})).toBe(true);
  });
});
