import type { LockInfo } from "@tau/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServiceManager } from "../service/manager";
import { CLI, createTestNode } from "../service/test-context";
import { runBareWith } from "./bare";
import type { LifecycleDeps } from "./deps";

const RUNNING: LockInfo = { pid: 4242, url: "http://127.0.0.1:4317", version: "1.2.3" };
const URL_LINE = "Open: http://127.0.0.1:4317/?token=tok";
const PAIR = "To use tau from your phone or another device, run: tau pair";

function setup(
  options: {
    instance?: LockInfo;
    platform?: NodeJS.Platform;
    xdg?: string | undefined;
    noInstance?: boolean;
  } = {},
) {
  const node = createTestNode(
    {
      platform: options.platform ?? "darwin",
      xdgRuntimeDir: "xdg" in options ? options.xdg : "/run/user/501",
    },
    (line) => (line.startsWith("launchctl print gui/501/") ? { stdout: "pid = 4242\n" } : undefined),
  );
  const output: string[] = [];
  const opened: string[] = [];
  const instance = { current: options.noInstance ? undefined : (options.instance ?? RUNNING) };
  const deps: LifecycleDeps = {
    context: node.context,
    cli: () => CLI,
    version: () => "1.2.3",
    readInstance: async () => instance.current,
    waitForInstanceUrl: async () => instance.current,
    readToken: async () => "tok",
    openBrowser: async (url) => void opened.push(url),
    out: (message) => output.push(message),
    fileExists: () => true,
  };
  return { node, deps, output, opened, instance };
}

afterEach(() => {
  process.exitCode = 0;
});

describe("bare output", () => {
  it("first run: installs, prints the service line, the token URL and the pair line, no QR", async () => {
    const { deps, output, opened } = setup();
    await runBareWith(deps, []);
    expect(output).toEqual([
      "Installing the tau service (launchd)...",
      "tau is running as a service. It starts at login and restarts if it crashes.",
      URL_LINE,
      PAIR,
    ]);
    expect(opened).toEqual(["http://127.0.0.1:4317/?token=tok"]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("re-run while running: prints the already-running line, nothing installed", async () => {
    const { node, deps, output } = setup();
    await createServiceManager(node.context, CLI, node.tauHome).install();
    node.runner.calls.length = 0;
    await runBareWith(deps, ["--no-open"]);
    expect(output).toEqual(["tau 1.2.3 is already running as a service.", URL_LINE, PAIR]);
    expect(node.runner.calls.some((call) => call.includes("bootstrap"))).toBe(false);
  });

  it("--no-open still prints the URL and does not open", async () => {
    const { deps, output, opened } = setup();
    await runBareWith(deps, ["--no-open"]);
    expect(output).toContain(URL_LINE);
    expect(opened).toEqual([]);
  });

  it("stale service: repairs, then prints the service line", async () => {
    const { node, deps, output } = setup();
    await createServiceManager(node.context, { ...CLI, command: "/old/node" }, node.tauHome).install();
    await runBareWith(deps, ["--no-open"]);
    expect(output[0]).toBe("Repairing the tau service...");
    expect(output).toContain("tau is running as a service. It starts at login and restarts if it crashes.");
  });

  it("running version differs: restarts once with Repairing", async () => {
    const { node, deps, output } = setup({ instance: { ...RUNNING, version: "1.0.0" } });
    await createServiceManager(node.context, CLI, node.tauHome).install();
    node.runner.calls.length = 0;
    await runBareWith(deps, ["--no-open"]);
    expect(output.filter((line) => line === "Repairing the tau service...")).toHaveLength(1);
    expect(node.runner.calls.some((call) => call.includes("kickstart") || call.includes("bootstrap"))).toBe(
      true,
    );
  });

  it("detached (no service manager): warning, URL, pair line, exit 0, no repeated install", async () => {
    const { deps, output, node } = setup({ platform: "linux", xdg: undefined, noInstance: true });
    await runBareWith({ ...deps, waitForInstanceUrl: async () => RUNNING }, ["--no-open"]);
    expect(output).toContain(
      "No service manager here. tau runs in the background and will not survive a reboot or logout.",
    );
    expect(output.some((line) => line.includes("enable-linger"))).toBe(true);
    expect(output.slice(-2)).toEqual([URL_LINE, PAIR]);
    expect(process.exitCode ?? 0).toBe(0);
    expect(node.runner.calls.filter((call) => call.includes("systemctl"))).toEqual([]);
  });

  it("service install failure: message, exit 1, no URL", async () => {
    const { deps, output } = setup();
    const broken = { ...deps, cli: () => ({ ...CLI, args: ["/h/.npm/_npx/1/x/dist/bin.js"] }) };
    await runBareWith(broken, []);
    expect(output.at(-1)).toBe("Run: npx @pablopunk/tau");
    expect(process.exitCode).toBe(1);
  });

  it("not answering: exact message, exit 1", async () => {
    const { deps, output } = setup({ noInstance: true });
    await runBareWith(deps, ["--no-open"]);
    expect(output.at(-1)).toBe("tau did not start. Run `tau logs`.");
    expect(process.exitCode).toBe(1);
  });

  it("foreground holder: terminal message, exit 1, nothing installed", async () => {
    const { node, deps, output } = setup({ instance: { ...RUNNING, pid: 999 } });
    await createServiceManager(node.context, CLI, node.tauHome).install();
    node.runner.calls.length = 0;
    await runBareWith(deps, []);
    expect(output).toEqual([
      "tau is already running in a terminal (pid 999). Stop it (Ctrl+C), then run tau again.",
    ]);
    expect(process.exitCode).toBe(1);
    expect(node.runner.calls.filter((call) => /bootstrap|kickstart|start/.test(call))).toEqual([]);
  });
});

describe("bare waiting notice", () => {
  afterEach(() => vi.useRealTimers());

  it("prints 'Waiting for tau to start...' once after 3 s of waiting, not before", async () => {
    vi.useFakeTimers();
    const { deps: base, output } = setup();
    let release: (value: LockInfo) => void = () => undefined;
    let waiting = false;
    const deps: LifecycleDeps = {
      ...base,
      waitForInstanceUrl: () =>
        new Promise<LockInfo>((resolve) => {
          waiting = true;
          release = resolve;
        }),
    };
    const run = runBareWith(deps, ["--no-open"]);
    await vi.waitFor(() => expect(waiting).toBe(true), { interval: 1 });
    await vi.advanceTimersByTimeAsync(2900);
    expect(output).not.toContain("Waiting for tau to start...");
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(output.filter((line) => line === "Waiting for tau to start...")).toHaveLength(1);
    release(RUNNING);
    await run;
    expect(output).toContain(URL_LINE);
  });
});
