import { mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_UPLOAD_FILE_BYTES } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUploadStore, STAGED_FILE_TTL_MS } from "./upload-store";

const toBase64 = (text: string): string => Buffer.from(text).toString("base64");

let root: string;
let now: number;
const store = () => createUploadStore({ now: () => now, root });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tau-uploads-test-"));
  now = Date.now();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("stage", () => {
  it("stages bytes under a UUID virtual path", async () => {
    const ref = await store().stage({ name: "notes.txt", mimeType: "text/plain", data: toBase64("hello") });
    expect(ref).toEqual({
      name: "notes.txt",
      path: expect.stringMatching(/^uploads\/[0-9a-f-]{36}$/),
      size: 5,
    });
    const again = await store().stage({ name: "notes.txt", mimeType: "text/plain", data: toBase64("hello") });
    expect(again.path).not.toBe(ref.path);
  });

  it("rejects path names, bad base64 and oversize files", async () => {
    const uploads = store();
    await expect(
      uploads.stage({ name: "../evil.txt", mimeType: "text/plain", data: toBase64("x") }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(
      uploads.stage({ name: "a/b.txt", mimeType: "text/plain", data: toBase64("x") }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(
      uploads.stage({ name: "x.txt", mimeType: "text/plain", data: "!!!not-base64!!!" }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(
      uploads.stage({ name: "x.txt", mimeType: "text/plain", data: "abcd===" }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(
      uploads.stage({
        name: "big.bin",
        mimeType: "application/octet-stream",
        data: Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1).toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("sanitizes the on-disk extension and writes user-readable files only", async () => {
    const ref = await store().stage({ name: "run.sh", mimeType: "text/plain", data: toBase64("x") });
    const names = await readdir(root);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^file-[0-9a-f-]{36}\.sh$/);
    expect((await stat(join(root, names[0] as string))).mode & 0o777).toBe(0o600);
    // A name without a usable extension falls back to `.bin`.
    await store().stage({ name: "Makefile", mimeType: "text/plain", data: toBase64("x") });
    expect((await readdir(root)).some((name) => name.endsWith(".bin"))).toBe(true);
    expect(ref.name).toBe("run.sh");
  });

  it("leaves no partial file behind when the write fails", async () => {
    const before = await readdir(root);
    await expect(
      store().stage({ name: "x.txt", mimeType: "text/plain", data: "not base64 at all!!" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await readdir(root)).toEqual(before);
  });

  it("lazily sweeps its own stale files but keeps strangers", async () => {
    const uploads = store();
    const old = await uploads.stage({ name: "old.txt", mimeType: "text/plain", data: toBase64("old") });
    const names = await readdir(root);
    expect(names).toHaveLength(1);
    const diskName = names[0] as string;
    // Backdate past the TTL, keep an unrelated file, then stage again to trigger the sweep.
    const past = new Date(now - STAGED_FILE_TTL_MS - 1000);
    await utimes(join(root, diskName), past, past);
    await writeFile(join(root, "keep.txt"), "stranger");
    await uploads.stage({ name: "new.txt", mimeType: "text/plain", data: toBase64("new") });
    const after = await readdir(root);
    expect(after).not.toContain(diskName);
    expect(after).toContain("keep.txt");
    await expect(uploads.resolveRefs([old])).rejects.toMatchObject({ code: "file_expired" });
  });
});

describe("resolveRefs", () => {
  it("resolves staged refs to direct children of the root", async () => {
    const uploads = store();
    const ref = await uploads.stage({ name: "notes.txt", mimeType: "text/plain", data: toBase64("hello") });
    const [resolved] = await uploads.resolveRefs([ref]);
    expect(resolved?.absPath.startsWith(`${await realpath(root)}/`)).toBe(true);
    expect(resolved?.ref).toBe(ref);
  });

  it("rejects paths outside the uploads root", async () => {
    const uploads = store();
    for (const path of ["../secret.txt", "/etc/passwd", "uploads/../../etc/passwd", "uploads/not-a-uuid"]) {
      await expect(uploads.resolveRefs([{ name: "evil.txt", path, size: 1 }])).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
  });

  it("expires unknown, missing and replaced refs with an actionable message", async () => {
    const uploads = store();
    const missing = { name: "gone.txt", path: "uploads/00000000-0000-4000-8000-000000000000", size: 1 };
    await expect(uploads.resolveRefs([missing])).rejects.toMatchObject({
      code: "file_expired",
      message: expect.stringMatching(/stage it again/i),
    });
    // A staged file deleted out from under the ref is expired, not found.
    const ref = await uploads.stage({ name: "doomed.txt", mimeType: "text/plain", data: toBase64("x") });
    const names = await readdir(root);
    await rm(join(root, names[0] as string));
    await expect(uploads.resolveRefs([ref])).rejects.toMatchObject({ code: "file_expired" });
    // A ref whose bytes were swapped no longer describes the staged file.
    const swapped = await uploads.stage({ name: "swapped.txt", mimeType: "text/plain", data: toBase64("a") });
    const diskNames = await readdir(root);
    await writeFile(join(root, diskNames[0] as string), "a much longer body");
    await expect(uploads.resolveRefs([swapped])).rejects.toMatchObject({ code: "file_expired" });
  });

  it("refuses symlinks that escape the root", async () => {
    const uploads = store();
    const ref = await uploads.stage({ name: "link.txt", mimeType: "text/plain", data: toBase64("x") });
    const id = ref.path.slice("uploads/".length);
    const names = await readdir(root);
    const outside = join(tmpdir(), `tau-uploads-outside-${Date.now()}`);
    await mkdir(outside, { recursive: true });
    try {
      await writeFile(join(outside, "secret"), "secret");
      await rm(join(root, names[0] as string));
      await symlink(join(outside, "secret"), join(root, `file-${id}.txt`));
      await expect(uploads.resolveRefs([ref])).rejects.toMatchObject({ code: "invalid_request" });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("expires refs older than the TTL", async () => {
    const uploads = store();
    const ref = await uploads.stage({ name: "old.txt", mimeType: "text/plain", data: toBase64("x") });
    now += STAGED_FILE_TTL_MS + 1000;
    await expect(uploads.resolveRefs([ref])).rejects.toMatchObject({ code: "file_expired" });
  });
});
