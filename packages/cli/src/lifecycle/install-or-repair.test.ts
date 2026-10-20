import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { LockInfo } from "@tau/core";
import { afterEach, describe, expect, it } from "vitest";
import { pidFileOf, recordFileOf } from "../service/spec";
import { CLI, createTestNode } from "../service/test-context";
import type { LifecycleDeps } from "./deps";
import { installOrRepairService } from "./install-or-repair";
import { runRestartWith } from "./restart";

const RUNNING: LockInfo = { pid: 4242, url: "http://127.0.0.1:4317", version: "1.2.3" };

function setup(options: { instance?: LockInfo; onBootstrap?: () => void } = {}) {
  const node = createTestNode({}, (line) => {
    if (line.startsWith("launchctl bootstrap")) options.onBootstrap?.();
    return line.startsWith("launchctl print gui/501/") ? { stdout: "pid = 4242\n" } : undefined;
  });
  const output: string[] = [];
  const deps: LifecycleDeps = {
    context: node.context,
    cli: () => CLI,
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

  it("an old { node, entry } record counts as one repair, then settles", async () => {
    const { node, deps } = setup();
    await installOrRepairService(deps, node.tauHome);
    writeFileSync(recordFileOf(node.tauHome), JSON.stringify({ node: CLI.command, entry: CLI.args[0] }));
    expect(await installOrRepairService(deps, node.tauHome)).toMatchObject({
      kind: "ready",
      changed: true,
      repairing: true,
    });
    expect(await installOrRepairService(deps, node.tauHome)).toMatchObject({ changed: false });
  });

  it("refuses a foreground server and installs nothing", async () => {
    const { node, deps, output } = setup({ instance: RUNNING });
    await runRestartWith(deps, ["--home", node.tauHome]);
    expect(output.join("\n")).toContain("running in a terminal");
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

describe("no usable user systemd: install falls back instead of failing", () => {
  function linuxSetup() {
    const base = setup();
    const node = createTestNode({ platform: "linux" }, (line) =>
      line.startsWith("systemctl") ? { code: 1 } : undefined,
    );
    return { node, deps: { ...base.deps, context: node.context }, output: base.output };
  }

  it("the shared step is ready and starts tau detached", async () => {
    const { node, deps } = linuxSetup();
    expect(await installOrRepairService(deps, node.tauHome, { keepDetached: true })).toMatchObject({
      kind: "ready",
      changed: true,
    });
    expect(node.runner.detached).toHaveLength(1);
  });

  it("tau restart completes detached, without the fallback warning being an error", async () => {
    const { node, deps, output } = linuxSetup();
    await runRestartWith(deps, ["--home", node.tauHome]);
    expect(process.exitCode).toBeUndefined();
    expect(output.join("\n")).not.toContain("Could not install");
    expect(node.runner.detached.length).toBeGreaterThan(0);
  });
});
