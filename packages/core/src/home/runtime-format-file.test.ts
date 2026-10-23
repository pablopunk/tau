import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CURRENT_FORMAT } from "../harness/runtime-format";
import { useTempDir } from "../test-support/temp-dir";
import { ensureRuntimeFormat, guardRuntimeFormatAtStartup, runtimeFormatPath } from "./runtime-format-file";

const tempDir = useTempDir();

const reader = { formatVersion: 1, capabilities: [] as string[] };
const write = (root: string, value: unknown) =>
  writeFile(runtimeFormatPath(root), typeof value === "string" ? value : JSON.stringify(value));

describe("guardRuntimeFormatAtStartup", () => {
  it("accepts an absent manifest and creates nothing", async () => {
    const root = await tempDir();

    await expect(guardRuntimeFormatAtStartup(root, reader)).resolves.toBeUndefined();

    expect(await readdir(root)).toEqual([]);
  });

  it("accepts a manifest this build reads", async () => {
    const root = await tempDir();
    await write(root, { formatVersion: 1, requiredCapabilities: [], writtenAt: 1 });

    await expect(guardRuntimeFormatAtStartup(root, reader)).resolves.toBeUndefined();
  });

  it("refuses a newer format with a forbidden error", async () => {
    const root = await tempDir();
    await write(root, { formatVersion: 2, requiredCapabilities: [], writtenAt: 1 });

    await expect(guardRuntimeFormatAtStartup(root, reader)).rejects.toMatchObject({
      code: "forbidden",
      message: expect.stringContaining("newer-format"),
    });
  });

  it("refuses a missing capability", async () => {
    const root = await tempDir();
    await write(root, { formatVersion: 1, requiredCapabilities: ["checkpoint-graph"], writtenAt: 1 });

    await expect(guardRuntimeFormatAtStartup(root, reader)).rejects.toMatchObject({
      code: "forbidden",
      message: expect.stringContaining("missing-capability"),
    });
  });

  it.each(["{not json", "null", "[]", '{"formatVersion":"1"}', ""])(
    "refuses a corrupt manifest (%j)",
    async (text) => {
      const root = await tempDir();
      await write(root, text);

      await expect(guardRuntimeFormatAtStartup(root, reader)).rejects.toMatchObject({
        code: "forbidden",
        message: expect.stringContaining("corrupt"),
      });
    },
  );
});

describe("ensureRuntimeFormat", () => {
  it("writes the current manifest atomically with private permissions and no temp file left", async () => {
    const root = await tempDir();

    await ensureRuntimeFormat(root, () => 1234);

    const parsed = JSON.parse(await readFile(runtimeFormatPath(root), "utf8"));
    expect(parsed).toEqual({
      formatVersion: CURRENT_FORMAT.formatVersion,
      requiredCapabilities: [...CURRENT_FORMAT.capabilities],
      writtenAt: 1234,
    });
    expect((await stat(runtimeFormatPath(root))).mode & 0o777).toBe(0o600);
    expect(await readdir(root)).toEqual(["runtime-format.json"]);
  });

  it("is idempotent: a second call keeps the first bytes", async () => {
    const root = await tempDir();
    await ensureRuntimeFormat(root, () => 1);
    const first = await readFile(runtimeFormatPath(root), "utf8");

    await ensureRuntimeFormat(root, () => 2);
    await Promise.all([ensureRuntimeFormat(root, () => 3), ensureRuntimeFormat(root, () => 4)]);

    expect(await readFile(runtimeFormatPath(root), "utf8")).toBe(first);
    expect(JSON.parse(first).writtenAt).toBe(1);
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("never rewrites an existing older manifest", async () => {
    const root = await tempDir();
    const older = `${JSON.stringify({ formatVersion: 1, requiredCapabilities: [], writtenAt: 7 })}\n`;
    await write(root, older);

    await ensureRuntimeFormat(root, () => 99, { formatVersion: 3, capabilities: [] });

    expect(await readFile(runtimeFormatPath(root), "utf8")).toBe(older);
  });

  it("refuses and leaves a newer manifest untouched", async () => {
    const root = await tempDir();
    const newer = JSON.stringify({ formatVersion: 5, requiredCapabilities: [], writtenAt: 7 });
    await write(root, newer);

    await expect(ensureRuntimeFormat(root, () => 99, reader)).rejects.toMatchObject({ code: "forbidden" });

    expect(await readFile(runtimeFormatPath(root), "utf8")).toBe(newer);
  });

  it("refuses and never overwrites a corrupt manifest", async () => {
    const root = await tempDir();
    await write(root, "{half a file");

    await expect(ensureRuntimeFormat(root, () => 99, reader)).rejects.toMatchObject({
      code: "forbidden",
      message: expect.stringContaining("corrupt"),
    });

    expect(await readFile(runtimeFormatPath(root), "utf8")).toBe("{half a file");
  });

  it("treats a leftover temp file from a crashed write as no manifest", async () => {
    const root = await tempDir();
    await writeFile(`${runtimeFormatPath(root)}.crashed.tmp`, '{"formatVersion":');

    await guardRuntimeFormatAtStartup(root, reader);
    await ensureRuntimeFormat(root, () => 5);

    expect(JSON.parse(await readFile(runtimeFormatPath(root), "utf8")).writtenAt).toBe(5);
  });

  it("fails without leaving a temp file when the home is not writable", async () => {
    const root = `${await tempDir()}/missing`;

    await expect(ensureRuntimeFormat(root, () => 1)).rejects.toThrow();

    await mkdir(root);
    expect(await readdir(root)).toEqual([]);
  });
});
