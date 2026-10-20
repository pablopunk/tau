import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { LockInfo } from "@tau/core";
import { afterEach, describe, expect, it } from "vitest";
import { pidFileOf } from "../service/spec";
import { CLI, createTestNode } from "../service/test-context";
import type { LifecycleDeps } from "./deps";
import { installOrRepairService } from "./install-or-repair";
import { runRestartWith } from "./restart";

const RUNNING: LockInfo = { pid: 4242, url: "http://127.0.0.1:4317", version: "1.2.3" };

function setup(options: { instance?: LockInfo; entry?: string; onBootstrap?: () => void } = {}) {
  const node = createTestNode({}, (line) => {
    if (line.startsWith("launchctl bootstrap")) options.onBootstrap?.();
    return line.startsWith("launchctl print gui/501/") ? { stdout: "pid = 4242\n" } : undefined;
  });
  const output: string[] = [];
  const deps: LifecycleDeps = {
    context: node.context,
    cli: () => ({ ...CLI, args: [options.entry ?? CLI.args[0]] }),
    version: () => "1.2.3",
    readInstance: async () => options.instance,
    waitForInstanceUrl: async () => options.instance,
    readToken: async () => "tok",
    openBrowser: async () => undefined,
    out: (message) => output.push(message),
    fileExists: () => true,
  };
  return { node, deps, output };
}

const bootstrapped = (node: ReturnType<typeof setup>["node"]) =>
  node.runner.calls.some((call) => call.startsWith("launchctl bootstrap"));

afterEach(() => {
  process.exitCode = undefined;
});

describe("service gap: restart installs a missing service", () => {
  it("tau restart on a home with no service installs it", async () => {
    const { node, deps, output } = setup();
    await runRestartWith(deps, ["--home", node.tauHome]);
    expect(bootstrapped(node)).toBe(true);
    expect(output.join("\n")).toContain("Installing the tau service");
  });

  it("the shared step reports ready, and a second call changes nothing", async () => {
    const { node, deps } = setup();
    expect(await installOrRepairService(deps, node.tauHome)).toMatchObject({ kind: "ready", changed: true });
    node.runner.calls.length = 0;
    expect(await installOrRepairService(deps, node.tauHome)).toEqual({
      kind: "ready",
      changed: false,
      repairing: false,
    });
    expect(bootstrapped(node)).toBe(false);
  });

  it("refuses a foreground server and installs nothing", async () => {
    const { node, deps, output } = setup({ instance: RUNNING });
    await runRestartWith(deps, ["--home", node.tauHome]);
    expect(output.join("\n")).toContain("running in a terminal");
    expect(process.exitCode).toBe(1);
    expect(bootstrapped(node)).toBe(false);
  });

  it("keeps the npx hint for a temporary entry", async () => {
    const { node, deps, output } = setup({ entry: "/h/.npm/_npx/9/tau/dist/bin.js" });
    await runRestartWith(deps, ["--home", node.tauHome]);
    expect(output).toContain("Run: npx @pablopunk/tau");
    expect(process.exitCode).toBe(1);
    expect(bootstrapped(node)).toBe(false);
  });

  it("stops a background tau before bootstrapping the service", async () => {
    let pidFileAtBootstrap: boolean | undefined;
    const holder: { home?: string } = {};
    const { node, deps } = setup({
      instance: RUNNING,
      onBootstrap: () => {
        pidFileAtBootstrap = existsSync(pidFileOf(holder.home ?? ""));
      },
    });
    holder.home = node.tauHome;
    mkdirSync(node.tauHome, { recursive: true });
    writeFileSync(pidFileOf(node.tauHome), "4242");
    const result = await installOrRepairService(deps, node.tauHome);
    expect(result.kind).toBe("ready");
    expect(bootstrapped(node)).toBe(true);
    expect(pidFileAtBootstrap).toBe(false);
  });
});
