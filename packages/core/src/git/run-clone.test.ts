import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installFakeGit, isAlive } from "../test-support/fake-git";
import { useTempDir } from "../test-support/temp-dir";
import { startClone } from "./run-clone";

const tempDir = useTempDir();
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("git clone process", () => {
  it("uses the protocol allowlist, the quiet environment and a detached group", async () => {
    const root = await tempDir();
    const fake = await installFakeGit(root);
    const run = startClone({
      url: "https://example.com/x.git",
      directory: join(root, "out"),
      env: { ...fake.env(process.env), GIT_SSH_COMMAND: "ssh -i key" },
      allowFileClones: false,
    });
    await expect.poll(() => exists(join(fake.stateDir, "git.pid"))).toBe(true);
    run.kill();
    expect(await run.done).toEqual({ ok: false, error: "Cancelled" });
    expect(await readFile(join(fake.stateDir, "args"), "utf8")).toBe(
      `-c protocol.allow=never -c protocol.https.allow=always -c protocol.ssh.allow=always clone --no-recurse-submodules -- https://example.com/x.git ${join(root, "out")}\n`,
    );
  });

  it("kills the whole group on timeout", async () => {
    const root = await tempDir();
    const fake = await installFakeGit(root);
    const run = startClone({
      url: "https://example.com/x.git",
      directory: join(root, "out"),
      env: fake.env(process.env),
      allowFileClones: false,
      timeoutMs: 300,
    });
    expect(await run.done).toEqual({ ok: false, error: "Timed out after 10 minutes" });
    const sleeper = Number(await readFile(join(fake.stateDir, "sleeper.pid"), "utf8"));
    await expect.poll(() => isAlive(sleeper)).toBe(false);
  });

  it("reports the last stderr line of a failure", async () => {
    const root = await tempDir();
    const run = startClone({
      url: "https://127.0.0.1:1/none.git",
      directory: join(root, "out"),
      env: process.env,
      allowFileClones: false,
    });
    const outcome = await run.done;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.error).not.toBe("");
  });
});
