import { stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { readOrCreateDeviceId } from "./device-id";

const tempDir = useTempDir();

describe("readOrCreateDeviceId", () => {
  it("creates a private id once and returns the same one afterwards", async () => {
    const file = join(await tempDir(), "device-id");
    const first = await readOrCreateDeviceId(file);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readOrCreateDeviceId(file)).toBe(first);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});
