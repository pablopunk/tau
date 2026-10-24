import { execFile } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildSeatbeltProfile } from "./profile";
import { buildSystemdSandboxPrefix } from "./unit";

const run = promisify(execFile);
const canExec = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const temp = async (prefix: string, parent = tmpdir()) => {
  const dir = await mkdtemp(join(parent, prefix));
  dirs.push(dir);
  return dir;
};

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const onMacSandbox = process.platform === "darwin" && canExec(SANDBOX_EXEC);

describe.runIf(onMacSandbox)("macOS Seatbelt confinement, really enforced", () => {
  // Seatbelt resolves symlinks (`/var` -> `/private/var`): the profile root
  // must be the canonical root, exactly as `resolveSandboxRoot` provides it.
  const sandboxed = (wt: string, command: string, extra: string[] = []) =>
    run(
      SANDBOX_EXEC,
      [
        "-p",
        buildSeatbeltProfile({ root: realpathSync(wt), extraWritePaths: extra }),
        "/bin/sh",
        "-c",
        command,
      ],
      { timeout: 20_000 },
    );

  it("allows writes inside, denies writes outside", async () => {
    const wt = realpathSync(await temp("pi-sb-in-"));
    const outside = realpathSync(await temp("pi-sb-out-"));
    await sandboxed(wt, `echo hi > ${wt}/in.txt && cat ${wt}/in.txt`).then((result) =>
      expect(result.stdout).toContain("hi"),
    );
    await expect(sandboxed(wt, `echo hi > ${outside}/out.txt`)).rejects.toThrow();
    await expect(stat(join(outside, "out.txt"))).rejects.toThrow();
  });

  it("children can signal children: no blanket deny-signal", async () => {
    const wt = await temp("pi-sb-sig-");
    const result = await sandboxed(
      wt,
      "sleep 30 & p=$!; kill $p; wait $p 2>/dev/null; kill -0 $p 2>/dev/null && echo ALIVE || echo DEAD",
    );
    expect(result.stdout).toContain("DEAD");
  });

  it("a shell timeout of a child works from inside", async () => {
    const wt = await temp("pi-sb-tmo-");
    const command =
      "command -v timeout >/dev/null && timeout 0.2 sleep 30; echo done;" +
      "sleep 30 & p=$!; kill $p; wait $p 2>/dev/null; echo done";
    const result = await sandboxed(wt, command);
    expect(result.stdout).toContain("done");
  });
});

describe("macOS Seatbelt confinement, really enforced", () => {
  it.runIf(!onMacSandbox)("skips without sandbox-exec", () => {
    expect(onMacSandbox).toBe(false);
  });
});

const canEnforceSystemdSandbox = async (): Promise<boolean> => {
  if (process.platform !== "linux") return false;
  if (!canExec("/usr/bin/systemd-run")) return false;
  const root = await temp("tau-sandbox-probe-in-", process.cwd());
  const outside = await temp("tau-sandbox-probe-out-", process.cwd());
  const insideFile = join(root, "inside.txt");
  const outsideFile = join(outside, "outside.txt");
  try {
    await run(
      "/usr/bin/systemd-run",
      [
        "--user",
        "--pipe",
        "--wait",
        "--collect",
        `--unit=tau-sandbox-probe-${process.pid}.service`,
        `--working-directory=${root}`,
        "--property=ProtectSystem=strict",
        "--property=ProtectHome=read-only",
        `--property=ReadWritePaths=${root}`,
        "--property=PrivateTmp=yes",
        "--",
        process.execPath,
        "-e",
        "require('node:fs').writeFileSync(process.argv[1], 'inside'); require('node:fs').writeFileSync(process.argv[2], 'outside')",
        insideFile,
        outsideFile,
      ],
      { timeout: 30_000 },
    );
    return false;
  } catch {
    const insideAllowed = await stat(insideFile).then(
      (file) => file.isFile(),
      () => false,
    );
    const outsideDenied = await stat(outsideFile).then(
      () => false,
      () => true,
    );
    return insideAllowed && outsideDenied;
  }
};

describe("Linux systemd confinement, really enforced", () => {
  it("allows writes inside, denies writes outside", async ({ skip }) => {
    if (!(await canEnforceSystemdSandbox()))
      skip("systemd user sandbox cannot enforce filesystem confinement");
    const wt = await temp("pi-sb-lin-", process.cwd());
    const outside = await temp("pi-sb-lout-", process.cwd());
    const prefix = buildSystemdSandboxPrefix({
      systemdRun: "/usr/bin/systemd-run",
      root: wt,
      unit: `tau-sandbox-test-${process.pid}-a`,
      workingDirectory: wt,
    });
    const runInside = (command: string) =>
      run(prefix.file, [...prefix.args, "/bin/sh", "-c", command], { timeout: 30_000 });
    await runInside(`echo hi > ${wt}/in.txt`);
    expect((await stat(join(wt, "in.txt"))).isFile()).toBe(true);
    await expect(runInside(`echo hi > ${outside}/out.txt`)).rejects.toThrow();
    await expect(stat(join(outside, "out.txt"))).rejects.toThrow();
  }, 60_000);
});
