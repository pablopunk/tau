import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { FileCredentialStore } from "./file-credential-store";

const tempDir = useTempDir();
const apiKey = (key: string) => ({ type: "api_key" as const, key });

async function newStore() {
  const dir = await tempDir();
  const path = join(dir, "credentials.json");
  return { dir, path, store: new FileCredentialStore(path) };
}

describe("FileCredentialStore", () => {
  it("reads nothing before anything is stored", async () => {
    const { store } = await newStore();
    expect(await store.read("openrouter")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("stores a credential in a 0600 file that a new store instance can read", async () => {
    const { path, store } = await newStore();
    expect(await store.modify("openrouter", async () => apiKey("sk-1"))).toEqual(apiKey("sk-1"));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await new FileCredentialStore(path).read("openrouter")).toEqual(apiKey("sk-1"));
    expect(await store.list()).toEqual([{ providerId: "openrouter", type: "api_key" }]);
  });

  it("shows the current credential to modify, and keeps it when modify returns undefined", async () => {
    const { store } = await newStore();
    await store.modify("openrouter", async () => apiKey("sk-1"));
    const seen: unknown[] = [];
    const result = await store.modify("openrouter", async (current) => {
      seen.push(current);
      return undefined;
    });
    expect(seen).toEqual([apiKey("sk-1")]);
    expect(result).toEqual(apiKey("sk-1"));
  });

  it("serializes concurrent writes so none is lost", async () => {
    const { store } = await newStore();
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.modify(`provider-${index}`, async () => apiKey(`k${index}`)),
      ),
    );
    expect((await store.list()).length).toBe(20);
  });

  it("keeps working after a failing modify", async () => {
    const { store } = await newStore();
    await expect(
      store.modify("openrouter", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await store.modify("openrouter", async () => apiKey("sk-2"));
    expect(await store.read("openrouter")).toEqual(apiKey("sk-2"));
  });

  it("deletes a credential and leaves the others", async () => {
    const { store } = await newStore();
    await store.modify("a", async () => apiKey("1"));
    await store.modify("b", async () => apiKey("2"));
    await store.delete("a");
    expect(await store.read("a")).toBeUndefined();
    expect(await store.read("b")).toEqual(apiKey("2"));
  });

  it("leaves no temp files behind", async () => {
    const { dir, store } = await newStore();
    await store.modify("a", async () => apiKey("1"));
    expect(await readdir(dir)).toEqual(["credentials.json"]);
  });

  it("rejects instead of overwriting a file it cannot understand", async () => {
    const { path, store } = await newStore();
    await writeFile(path, "[1,2]");
    await expect(store.modify("a", async () => apiKey("1"))).rejects.toThrow("JSON object");
  });
});
