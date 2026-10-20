import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { bundledDaemonPath, createLocalTerminalDaemon } from "./terminal-daemon";

const tempDir = useTempDir();

describe("terminal daemon with a version folder", () => {
  it("is available only when <versionDir>/pi-env is an executable file", async () => {
    const versionDir = await tempDir();
    const daemon = createLocalTerminalDaemon({}, versionDir);
    expect(bundledDaemonPath(versionDir)).toBe(join(versionDir, "pi-env"));
    expect(await daemon.available()).toBe(false);
    await writeFile(join(versionDir, "pi-env"), "#!/bin/sh\n");
    await chmod(join(versionDir, "pi-env"), 0o755);
    expect(await daemon.available()).toBe(true);
  });
});
