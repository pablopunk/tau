import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifySignature } from "@tau/protocol/identity";
import { describe, expect, it } from "vitest";
import { createNodeIdentityStore } from "./node-identity";

const tempFile = async () => join(await mkdtemp(join(tmpdir(), "tau-identity-")), "node.json");

describe("node identity store", () => {
  it("creates node.json at first load with mode 0600 and a self-certifying id", async () => {
    const file = await tempFile();
    const identity = await createNodeIdentityStore(file).load();
    expect(identity.nodeId).toMatch(/^[a-z2-7]{52}$/);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(verifySignature(identity.publicKey, "x", identity.sign("x"))).toBe(true);
  });

  it("keeps the same identity across loads", async () => {
    const file = await tempFile();
    const first = await createNodeIdentityStore(file).load();
    const second = await createNodeIdentityStore(file).load();
    expect(second.nodeId).toBe(first.nodeId);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("never exposes the private key in the identity object", async () => {
    const file = await tempFile();
    const identity = await createNodeIdentityStore(file).load();
    const stored = JSON.parse(await readFile(file, "utf8")) as { privateKey: string };
    expect(JSON.stringify(identity)).not.toContain(stored.privateKey);
  });

  it("makes a new key and id after reset", async () => {
    const file = await tempFile();
    const store = createNodeIdentityStore(file);
    const before = await store.load();
    await store.reset();
    await store.reset();
    expect((await store.load()).nodeId).not.toBe(before.nodeId);
  });

  it("refuses a damaged or mismatched file instead of silently changing the id", async () => {
    const file = await tempFile();
    const store = createNodeIdentityStore(file);
    await writeFile(file, "{ not json");
    await expect(store.load()).rejects.toThrow(/damaged/);
    await store.reset();
    await store.load();
    const good = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    const otherFile = await tempFile();
    await createNodeIdentityStore(otherFile).load();
    const other = JSON.parse(await readFile(otherFile, "utf8")) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...good, privateKey: other.privateKey }));
    await expect(store.load()).rejects.toThrow(/damaged/);
  });
});
