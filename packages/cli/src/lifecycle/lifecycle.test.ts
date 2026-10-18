import type { LockInfo } from "@tau/core";
import { describe, expect, it, vi } from "vitest";
import { createServiceManager } from "../service/manager";
import { CLI, createTestMachine } from "../service/test-context";
import { runBareWith } from "./bare";
import type { LifecycleDeps } from "./deps";
import { runOpenWith } from "./open";
import { readStoredPort } from "./port-store";
import { runRestartWith } from "./restart";
import { runStartWith } from "./start";
import { runStatusWith } from "./status";
import { runStopWith } from "./stop";

function setup(options: { instance?: LockInfo; nodeExists?: boolean } = {}) {
  const machine = createTestMachine({}, (line) =>
    line.startsWith("launchctl print gui/501/") ? { stdout: "pid = 4242\n" } : undefined,
  );
  const output: string[] = [];
  const opened: string[] = [];
  const instance = { current: options.instance };
  const deps: LifecycleDeps = {
    context: machine.context,
    cli: () => CLI,
    version: () => "1.2.3",
    readInstance: async () => instance.current,
    waitForInstanceUrl: async () => instance.current,
    readToken: async () => "tok",
    openBrowser: async (url) => void opened.push(url),
    out: (message) => output.push(message),
    fileExists: () => options.nodeExists ?? true,
  };
  return { machine, deps, output, opened, instance };
}

const RUNNING: LockInfo = { pid: 4242, url: "http://127.0.0.1:4317", version: "1.2.3" };

describe("bare tau", () => {
  it("installs, starts and opens the browser on a fresh machine", async () => {
    const { machine, deps, opened } = setup({ instance: RUNNING });
    await runBareWith(deps, [], vi.fn());
    expect(machine.runner.calls.some((call) => call.startsWith("launchctl bootstrap"))).toBe(true);
    expect(opened).toEqual(["http://127.0.0.1:4317/?token=tok"]);
  });

  it("repairs a service whose recorded node moved, without reinstalling a healthy one", async () => {
    const { machine, deps } = setup({ instance: RUNNING });
    await createServiceManager(machine.context, { ...CLI, node: "/old/node" }, machine.tauHome).install();
    machine.runner.calls.length = 0;
    await runBareWith(deps, ["--no-open"], vi.fn());
    expect(machine.runner.calls.some((call) => call.startsWith("launchctl bootstrap"))).toBe(true);
    machine.runner.calls.length = 0;
    await runBareWith(deps, ["--no-open"], vi.fn());
    expect(machine.runner.calls.some((call) => call.includes("bootstrap"))).toBe(false);
  });

  it("serves in the foreground when tau runs from an npx cache", async () => {
    const { machine, deps, output } = setup({ instance: RUNNING });
    const serve = vi.fn(async () => undefined);
    const cached = { ...deps, cli: () => ({ ...CLI, entry: "/h/.npm/_npx/9/tau/dist/bin.js" }) };
    await runBareWith(cached, [], serve);
    expect(serve).toHaveBeenCalled();
    expect(output.join("\n")).toContain("Install tau globally first");
    expect(machine.runner.calls).toEqual([]);
  });

  it("stores --port for the service", async () => {
    const { machine, deps } = setup({ instance: RUNNING });
    await runBareWith(deps, ["--port", "5555", "--no-open"], vi.fn());
    expect(readStoredPort(machine.tauHome)).toBe(5555);
  });
});

describe("status", () => {
  it("says running (service) with pid, URL and version as JSON", async () => {
    const { machine, deps, output } = setup({ instance: RUNNING });
    await createServiceManager(machine.context, CLI, machine.tauHome).install();
    await runStatusWith(deps, ["--json"]);
    expect(JSON.parse(output[0] ?? "")).toMatchObject({
      installed: true,
      running: "service",
      pid: 4242,
      url: "http://127.0.0.1:4317",
      version: "1.2.3",
      node: CLI.node,
    });
  });

  it("says running (foreground) when the manager runs another pid", async () => {
    const { machine, deps, output } = setup({ instance: { ...RUNNING, pid: 99 } });
    await createServiceManager(machine.context, CLI, machine.tauHome).install();
    await runStatusWith(deps, []);
    expect(output[0]).toContain("running (foreground)");
  });

  it("warns about a version mismatch and a missing node", async () => {
    const { machine, deps, output } = setup({
      instance: { ...RUNNING, version: "1.0.0" },
      nodeExists: false,
    });
    await createServiceManager(machine.context, CLI, machine.tauHome).install();
    await runStatusWith(deps, []);
    expect(output[0]).toContain("run `tau restart`");
    expect(output[0]).toContain("node missing");
  });
});

describe("start, stop, restart, open", () => {
  it("start uses the installed service and stores --port", async () => {
    const { machine, deps, opened } = setup();
    await createServiceManager(machine.context, CLI, machine.tauHome).install();
    const started = { ...deps, readInstance: async () => undefined, waitForInstanceUrl: async () => RUNNING };
    machine.runner.calls.length = 0;
    await runStartWith(started, ["--port", "4400"]);
    expect(machine.runner.calls.some((call) => call.startsWith("launchctl bootstrap"))).toBe(true);
    expect(readStoredPort(machine.tauHome)).toBe(4400);
    expect(opened).toHaveLength(1);
  });

  it("start spawns a detached process for a home with no service", async () => {
    const { machine, deps } = setup();
    const started = { ...deps, readInstance: async () => undefined, waitForInstanceUrl: async () => RUNNING };
    await runStartWith(started, ["--home", `${machine.osHome}/e2e-home`, "--no-open"]);
    expect(machine.runner.detached).toHaveLength(1);
    expect(machine.runner.calls).toEqual([]);
  });

  it("stop boots the job out", async () => {
    const { machine, deps, output } = setup({ instance: RUNNING });
    await createServiceManager(machine.context, CLI, machine.tauHome).install();
    await runStopWith(deps, []);
    expect(machine.runner.calls.at(-1)).toBe("launchctl bootout gui/501/dev.tau.server");
    expect(output.at(-1)).toBe("tau stopped.");
  });

  it("stop leaves a foreground tau alone", async () => {
    const { deps, output, machine } = setup({ instance: { ...RUNNING, pid: 99 } });
    await runStopWith(deps, []);
    expect(output[0]).toContain("foreground");
    expect(machine.runner.calls.filter((call) => call.includes("bootout"))).toEqual([]);
  });

  it("restart kickstarts the installed service", async () => {
    const { machine, deps } = setup({ instance: RUNNING });
    await createServiceManager(machine.context, CLI, machine.tauHome).install();
    machine.runner.calls.length = 0;
    await runRestartWith(deps, []);
    expect(machine.runner.calls).toContain("launchctl kickstart -k gui/501/dev.tau.server");
  });

  it("open prints the not-running message when nothing runs", async () => {
    const { deps } = setup();
    await expect(runOpenWith(deps, [])).rejects.toThrow("tau is not running. Run `tau` to start it.");
  });
});
