import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFilePeersStore,
  hubFilePath,
  MIGRATED_HUB_FILE,
  migrateHubFile,
  migrateSummaryDirectory,
  peersFilePath,
} from "./peers-store";

const home = () => mkdtemp(join(tmpdir(), "tau-peers-"));
const HUB = { hubUrl: "https://hub.example", nodeSecret: "s".repeat(64), name: "Mac", nodeName: "Phone" };

describe("peers.json", () => {
  it("round-trips entries with mode 0600 and drops malformed lines", async () => {
    const dir = await home();
    const store = createFilePeersStore(peersFilePath(dir));
    expect(await store.read()).toEqual([]);
    await store.write([{ url: "https://a", name: "A", secret: "x", nodeId: "id", publicKey: "k" }]);
    expect((await stat(peersFilePath(dir))).mode & 0o777).toBe(0o600);
    await writeFile(
      peersFilePath(dir),
      JSON.stringify([{ url: "https://a", name: "A", secret: "x" }, { url: 1 }, "junk"]),
    );
    expect(await store.read()).toEqual([{ url: "https://a", name: "A", secret: "x" }]);
    await writeFile(peersFilePath(dir), "{ nope");
    expect(await store.read()).toEqual([]);
  });
});

describe("hub.json migration (a 0.1.x home)", () => {
  it("copies a one-entry peers.json without an id and leaves hub.json in place (downgrade keeps its link)", async () => {
    const dir = await home();
    await writeFile(hubFilePath(dir), `${JSON.stringify(HUB)}\n`);
    expect(await migrateHubFile(dir)).toBe(true);
    expect(await createFilePeersStore(peersFilePath(dir)).read()).toEqual([
      { url: HUB.hubUrl, name: "Mac", secret: HUB.nodeSecret, nodeName: "Phone" },
    ]);
    expect((await stat(peersFilePath(dir))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(hubFilePath(dir), "utf8"))).toEqual(HUB);
    await expect(stat(join(dir, MIGRATED_HUB_FILE))).rejects.toThrow();
    expect(await migrateHubFile(dir)).toBe(false);
  });

  it("is a no-op without hub.json, idempotent, and never overwrites an existing peers.json", async () => {
    const dir = await home();
    expect(await migrateHubFile(dir)).toBe(false);
    const store = createFilePeersStore(peersFilePath(dir));
    await store.write([{ url: "https://kept", name: "Kept", secret: "k" }]);
    await writeFile(hubFilePath(dir), JSON.stringify(HUB));
    await migrateHubFile(dir);
    expect(await store.read()).toEqual([{ url: "https://kept", name: "Kept", secret: "k" }]);
    expect(await migrateHubFile(dir)).toBe(false);
  });

  it("moves an unreadable hub.json aside without inventing a peer", async () => {
    const dir = await home();
    await writeFile(hubFilePath(dir), "{ broken");
    expect(await migrateHubFile(dir)).toBe(false);
    expect(await createFilePeersStore(peersFilePath(dir)).read()).toEqual([]);
    await expect(stat(join(dir, MIGRATED_HUB_FILE))).resolves.toBeDefined();
  });
});

describe("summary directory migration", () => {
  it("renames machines to nodes, keeping each id folder, once", async () => {
    const dir = await home();
    await mkdir(join(dir, "machines", "abc"), { recursive: true });
    await writeFile(join(dir, "machines", "abc", "summary.json"), "{}");
    expect(await migrateSummaryDirectory(dir)).toBe(true);
    await expect(stat(join(dir, "nodes", "abc", "summary.json"))).resolves.toBeDefined();
    await expect(stat(join(dir, "machines"))).rejects.toThrow();
    expect(await migrateSummaryDirectory(dir)).toBe(false);
  });

  it("leaves machines alone when nodes already exists, and does nothing for a fresh home", async () => {
    const dir = await home();
    expect(await migrateSummaryDirectory(dir)).toBe(false);
    await mkdir(join(dir, "machines"));
    await mkdir(join(dir, "nodes"));
    expect(await migrateSummaryDirectory(dir)).toBe(false);
    await expect(stat(join(dir, "machines"))).resolves.toBeDefined();
  });
});
