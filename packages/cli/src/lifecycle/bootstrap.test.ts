import { afterEach, describe, expect, it } from "vitest";
import { CLI, createTestNode } from "../service/test-context";
import type { CommandResult, RunCommand } from "../update/command-runner";
import { type BootstrapDeps, bootstrap, cleanEnvOf } from "./bootstrap";
import type { LifecycleDeps } from "./deps";

const OK: CommandResult = { code: 0, stdout: "", stderr: "" };
const ROOT = "/g/lib/node_modules";
const PKG = `${ROOT}/@pablopunk/tau`;
const NPX_ENTRY = "/h/.npm/_npx/9/node_modules/@pablopunk/tau/dist/bin.js";

interface Options {
  entry?: string;
  execPath?: string;
  env?: Record<string, string>;
  globalVersion?: string;
  installResult?: CommandResult;
  pnpmAnswers?: boolean;
  nodeOnPath?: string;
  platform?: NodeJS.Platform;
  handoverCode?: number;
}

function setup(options: Options = {}) {
  const calls: { command: string; args: readonly string[]; env?: NodeJS.ProcessEnv; stdio: string }[] = [];
  const installed = { version: options.globalVersion };
  const runCommand: RunCommand = async (command, args, run) => {
    calls.push({ command, args, env: run.env, stdio: run.stdio });
    const joined = args.join(" ");
    if (joined === "root -g") return { ...OK, stdout: `${ROOT}\n` };
    if (joined === "--version") return options.pnpmAnswers ? OK : { code: null, stdout: "", stderr: "x" };
    if (/^(i|add) -g /.test(joined)) {
      const result = options.installResult ?? OK;
      if (result.code === 0) installed.version = "1.2.3";
      return result;
    }
    if (args.includes("status")) return { ...OK, stdout: JSON.stringify({ cliVersion: "1.2.3" }) };
    return { ...OK, code: options.handoverCode ?? 0 };
  };
  const boot: BootstrapDeps = {
    runCommand,
    env: { PATH: "/usr/bin", ...options.env },
    execPath: options.execPath ?? "/n/bin/node",
    entry: options.entry ?? NPX_ENTRY,
    platform: options.platform ?? "darwin",
    readPackageVersion: (dir) => (dir === PKG ? installed.version : undefined),
    realpath: (path) => path,
    nodeOnPath: () => options.nodeOnPath,
  };
  const output: string[] = [];
  const node = createTestNode();
  const deps = {
    context: node.context,
    cli: () => CLI,
    version: () => "1.2.3",
    out: (message: string) => output.push(message),
    fileExists: () => true,
  } as unknown as LifecycleDeps;
  return { boot, deps, calls, output };
}

afterEach(() => {
  delete process.env.TAU_BOOTSTRAPPED;
});

describe("bootstrap", () => {
  it("skips when not a temporary runner", async () => {
    const { boot, deps, calls } = setup({ entry: "/g/lib/node_modules/@pablopunk/tau/dist/bin.js" });
    expect(await bootstrap(deps, boot, [])).toEqual({ kind: "skip" });
    expect(calls).toEqual([]);
  });

  it("npx first run: installs with npm i -g, verifies, hands over with the loop guard", async () => {
    const { boot, deps, calls, output } = setup({
      env: { npm_config_global: "", npm_execpath: "x", npm_lifecycle_event: "y" },
    });
    expect(await bootstrap(deps, boot, ["--no-open"])).toEqual({ kind: "handedOver", code: 0 });
    const install = calls.find((call) => call.args[0] === "i");
    expect(install).toMatchObject({
      command: "/n/bin/npm",
      args: ["i", "-g", "@pablopunk/tau@1.2.3"],
      stdio: "tee",
    });
    expect(Object.keys(install?.env ?? {}).some((key) => /^npm_/.test(key))).toBe(false);
    expect(output[0]).toBe("Installing tau 1.2.3 globally: npm i -g @pablopunk/tau@1.2.3");
    const last = calls.at(-1);
    expect(last).toMatchObject({ command: "/n/bin/node", stdio: "inherit" });
    expect(last?.args).toEqual([`${PKG}/dist/bin.js`, "--no-open"]);
    expect(last?.env?.TAU_BOOTSTRAPPED).toBe("1");
    expect(calls.some((call) => call.args.includes("status"))).toBe(true);
  });

  it("pnpm dlx uses pnpm add -g when pnpm answers, else npm", async () => {
    const entry = "/h/.cache/pnpm/dlx/abc/node_modules/@pablopunk/tau/dist/bin.js";
    const withPnpm = setup({ entry, pnpmAnswers: true });
    await bootstrap(withPnpm.deps, withPnpm.boot, []);
    expect(
      withPnpm.calls.some((c) => c.command === "pnpm" && c.args.join(" ") === "add -g @pablopunk/tau@1.2.3"),
    ).toBe(true);
    const without = setup({ entry });
    await bootstrap(without.deps, without.boot, []);
    expect(without.calls.some((c) => c.command === "/n/bin/npm" && c.args[0] === "i")).toBe(true);
  });

  it("bunx hands over with node from PATH, and fails without one", async () => {
    const entry = "/h/.bun/install/cache/@pablopunk/tau@1.2.3/dist/bin.js";
    const found = setup({ entry, execPath: "/h/.bun/bin/bun", nodeOnPath: "/usr/bin/node" });
    await bootstrap(found.deps, found.boot, []);
    expect(found.calls.at(-1)?.command).toBe("/usr/bin/node");
    expect(found.calls.some((c) => c.command === "/usr/bin/npm")).toBe(true);
    const none = setup({ entry, execPath: "/h/.bun/bin/bun" });
    expect(await bootstrap(none.deps, none.boot, [])).toEqual({
      kind: "failed",
      message: "No node found on PATH. Run: npm i -g @pablopunk/tau@1.2.3",
    });
    expect(none.calls).toEqual([]);
  });

  it("never downgrades a newer global: one note, no install", async () => {
    const { boot, deps, calls, output } = setup({ globalVersion: "2.0.0" });
    expect(await bootstrap(deps, boot, [])).toEqual({ kind: "handedOver", code: 0 });
    expect(calls.some((call) => call.args[0] === "i")).toBe(false);
    expect(output).toHaveLength(1);
    expect(output[0]).toContain("2.0.0");
  });

  it("skips the install for an equal global without a note", async () => {
    const { boot, deps, calls, output } = setup({ globalVersion: "1.2.3" });
    await bootstrap(deps, boot, []);
    expect(calls.some((call) => call.args[0] === "i")).toBe(false);
    expect(output).toEqual([]);
  });

  it("EACCES prints the permission text and the --prefix hint, never sudo", async () => {
    const { boot, deps } = setup({
      installResult: { code: 243, stdout: "", stderr: "EACCES: permission denied" },
    });
    const result = await bootstrap(deps, boot, []);
    expect(result.kind).toBe("failed");
    const message = result.kind === "failed" ? result.message : "";
    expect(message).toContain("Permission denied");
    expect(message).toContain("--prefix ~/.local");
    expect(message).not.toContain("sudo");
  });

  it("a failed install prints the manual command", async () => {
    const { boot, deps } = setup({ installResult: { code: 1, stdout: "", stderr: "offline" } });
    expect(await bootstrap(deps, boot, [])).toEqual({
      kind: "failed",
      message: "Could not install tau globally. Run: npm i -g @pablopunk/tau@1.2.3",
    });
  });

  it("a global that does not verify blocks the handover", async () => {
    const { boot, deps, calls } = setup();
    const wrong: BootstrapDeps = { ...boot, readPackageVersion: () => "0.0.1" };
    const result = await bootstrap(deps, wrong, []);
    expect(result.kind).toBe("failed");
    expect(calls.some((call) => call.stdio === "inherit")).toBe(false);
  });

  it("loop guard: a bootstrapped entry that is still temporary fails; the variable is deleted", async () => {
    const { boot, deps, calls } = setup({ env: { TAU_BOOTSTRAPPED: "1" } });
    process.env.TAU_BOOTSTRAPPED = "1";
    expect((await bootstrap(deps, boot, [])).kind).toBe("failed");
    expect(calls).toEqual([]);
    expect(process.env.TAU_BOOTSTRAPPED).toBeUndefined();
  });

  it("a bootstrapped global entry skips and drops the variable", async () => {
    const { boot, deps } = setup({ entry: "/g/dist/bin.js", env: { TAU_BOOTSTRAPPED: "1" } });
    process.env.TAU_BOOTSTRAPPED = "1";
    expect(await bootstrap(deps, boot, [])).toEqual({ kind: "skip" });
    expect(process.env.TAU_BOOTSTRAPPED).toBeUndefined();
  });

  it("propagates the handover exit code", async () => {
    const { boot, deps } = setup({ handoverCode: 7 });
    expect(await bootstrap(deps, boot, [])).toEqual({ kind: "handedOver", code: 7 });
  });

  it("uses npm.cmd on win32", async () => {
    const { boot, deps, calls } = setup({ platform: "win32", execPath: "C:\\n\\node.exe" });
    await bootstrap(deps, boot, []);
    expect(calls[0]?.command.endsWith("npm.cmd")).toBe(true);
  });
});

describe("cleanEnvOf", () => {
  it("drops npm variables; keeps npm_config_prefix only with the test seam", () => {
    const env = {
      PATH: "/p",
      npm_config_prefix: "/x",
      npm_config_global: "true",
      npm_package_name: "t",
      npm_execpath: "e",
    };
    expect(cleanEnvOf(env)).toEqual({ PATH: "/p" });
    expect(cleanEnvOf({ ...env, TAU_BOOTSTRAP_SPEC: "/t.tgz" })).toMatchObject({ npm_config_prefix: "/x" });
    expect(cleanEnvOf({ ...env, TAU_BOOTSTRAP_SPEC: "/t.tgz" }).npm_config_global).toBeUndefined();
  });
});
