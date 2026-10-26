import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BindingSnapshot, loadBindingSnapshots, saveBindingSnapshots } from "./binding-store";

const writer = vi.hoisted(() => ({ interruptedAfterBytes: null as number | null }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      const [path, data, options] = args;
      if (writer.interruptedAfterBytes === null) return actual.writeFile(...args);
      await actual.writeFile(path, String(data).slice(0, writer.interruptedAfterBytes), options);
      throw new Error("the writer was interrupted");
    },
  };
});

const snapshotOf = (sdkSessionId: string): BindingSnapshot => ({
  sdkSessionId,
  checkpoints: [{ length: 2, hash: "h", sdkUuid: "u" }],
  head: { length: 2, hash: "h" },
  created: [sdkSessionId],
  model: "haiku",
});

let dir = "";
let file = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tau-binding-store-"));
  file = join(dir, "bindings.json");
  writer.interruptedAfterBytes = null;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("binding snapshots on disk", () => {
  it("round-trips what was saved", async () => {
    await saveBindingSnapshots(file, { a: snapshotOf("s1") });
    expect(await loadBindingSnapshots(file)).toEqual({ a: snapshotOf("s1") });
  });

  it("a writer interrupted mid-write leaves the previous file whole and no stray temp file", async () => {
    await saveBindingSnapshots(file, { a: snapshotOf("s1") });
    writer.interruptedAfterBytes = 10;
    await saveBindingSnapshots(file, { a: snapshotOf("s2"), b: snapshotOf("s3") }).catch(() => undefined);
    writer.interruptedAfterBytes = null;
    expect(await loadBindingSnapshots(file)).toEqual({ a: snapshotOf("s1") });
    expect(await readdir(dir)).toEqual([basename(file)]);
  });

  it("a leftover partial temp file is never read as snapshots", async () => {
    await saveBindingSnapshots(file, { a: snapshotOf("s1") });
    await writeFile(`${file}.tmp-leftover`, '{"b":{"sdkSess', "utf8");
    expect(await loadBindingSnapshots(file)).toEqual({ a: snapshotOf("s1") });
  });

  it("a corrupt temp file with no real file reads as empty", async () => {
    await writeFile(`${file}.tmp-leftover`, "{not json", "utf8");
    expect(await loadBindingSnapshots(file)).toEqual({});
  });

  it("a save into a missing directory rejects instead of vanishing", async () => {
    await expect(
      saveBindingSnapshots(join(dir, "missing", "bindings.json"), { a: snapshotOf("s1") }),
    ).rejects.toThrow();
  });
});
