import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { swapCurrent } from "../update/install-layout";
import { createServiceManager, listServices } from "./manager";
import { renderPlist, renderSystemdUnit } from "./render";
import { buildSpec } from "./spec";
import { CLI, createTestNode } from "./test-context";

const plistOf = (osHome: string, label = "dev.tau.server") =>
  join(osHome, "Library", "LaunchAgents", `${label}.plist`);

describe("macOS (launchd)", () => {
  it("installs with bootout then bootstrap into gui/<uid>", async () => {
    const node = createTestNode();
    const manager = createServiceManager(node.context, CLI, node.tauHome);
    await manager.install();
    expect(node.runner.calls).toContain("launchctl bootout gui/501/dev.tau.server");
    const bootstrap = `launchctl bootstrap gui/501 ${plistOf(node.osHome)}`;
    expect(node.runner.calls.indexOf(bootstrap)).toBeGreaterThan(
      node.runner.calls.indexOf("launchctl bootout gui/501/dev.tau.server"),
    );
    expect(readFileSync(plistOf(node.osHome), "utf8")).toContain("<key>KeepAlive</key>");
  });

  it("waits for bootout to finish and retries a refused bootstrap (launchd tears jobs down async)", async () => {
    let printsLeft = 3;
    let refusals = 1;
    const node = createTestNode({}, (line) => {
      if (line === "launchctl print gui/501/dev.tau.server")
        return printsLeft-- > 0 ? { code: 0 } : { code: 113, stderr: "not found" };
      if (line.startsWith("launchctl bootstrap gui/501") && refusals-- > 0)
        return { code: 5, stderr: "Input/output error" };
      return undefined;
    });
    const warnings = await createServiceManager(node.context, CLI, node.tauHome).install();
    expect(warnings.join(" ")).not.toContain("detached");
    const calls = node.runner.calls;
    const lastPrint = calls.lastIndexOf("launchctl print gui/501/dev.tau.server");
    expect(lastPrint).toBeGreaterThan(calls.indexOf("launchctl bootout gui/501/dev.tau.server"));
    expect(calls.findIndex((line) => line.startsWith("launchctl bootstrap"))).toBeGreaterThan(lastPrint);
    expect(node.runner.detached).toEqual([]);
  });

  it("uses user/<uid> when there is no GUI session", async () => {
    const node = createTestNode({}, (line) =>
      line.includes(" gui/501") ? { code: 1, stderr: "no gui" } : undefined,
    );
    await createServiceManager(node.context, CLI, node.tauHome).install();
    expect(node.runner.calls).toContain(`launchctl bootstrap user/501 ${plistOf(node.osHome)}`);
    expect(node.runner.detached).toEqual([]);
  });

  it("falls back to a detached process with a warning when launchd refuses both", async () => {
    const node = createTestNode({}, (line) =>
      line.startsWith("launchctl") ? { code: 1, stderr: "denied" } : undefined,
    );
    const warnings = await createServiceManager(node.context, CLI, node.tauHome).install();
    expect(warnings.join(" ")).toContain("detached");
    expect(node.runner.detached).toEqual([`${CLI.command} ${CLI.args[0]} serve --service --no-open`]);
    expect(existsSync(plistOf(node.osHome))).toBe(false);
  });

  it("restart is kickstart -k, start is bootstrap, stop is bootout", async () => {
    const node = createTestNode();
    const manager = createServiceManager(node.context, CLI, node.tauHome);
    await manager.install();
    node.runner.calls.length = 0;
    await manager.restart();
    await manager.stop();
    await manager.start();
    expect(node.runner.calls).toContain("launchctl kickstart -k gui/501/dev.tau.server");
    expect(node.runner.calls).toContain("launchctl bootout gui/501/dev.tau.server");
    expect(node.runner.calls).toContain(`launchctl bootstrap gui/501 ${plistOf(node.osHome)}`);
  });

  it("restart copies PATH again and reloads the job when it changed", async () => {
    const node = createTestNode();
    await createServiceManager(node.context, CLI, node.tauHome).install();
    const changed = { ...node.context, env: { PATH: "/new/bin:/usr/bin" } };
    node.runner.calls.length = 0;
    await createServiceManager(changed, CLI, node.tauHome).restart();
    expect(readFileSync(plistOf(node.osHome), "utf8")).toContain("/new/bin");
    expect(node.runner.calls.some((call) => call.includes("kickstart"))).toBe(false);
    expect(node.runner.calls.some((call) => call.includes("bootstrap"))).toBe(true);
  });

  it("gives a non-default home its own label and leaves the user's service alone", async () => {
    const node = createTestNode();
    const dev = createServiceManager(node.context, CLI, join(node.osHome, "dev-home"));
    await dev.install();
    expect(dev.spec.names.launchdLabel).not.toBe("dev.tau.server");
    expect(existsSync(plistOf(node.osHome))).toBe(false);
    expect(await listServices(node.context)).toEqual([dev.spec.names.launchdLabel]);
    await dev.uninstall();
    expect(await listServices(node.context)).toEqual([]);
  });

  it("repairs when the recorded command is not the current one", async () => {
    const node = createTestNode();
    await createServiceManager(node.context, CLI, node.tauHome).install();
    const same = createServiceManager(node.context, CLI, node.tauHome);
    expect(await same.needsRepair()).toBe(false);
    const moved = createServiceManager(node.context, { ...CLI, command: "/new/node" }, node.tauHome);
    expect(await moved.needsRepair()).toBe(true);
    const untouched = createServiceManager(node.context, CLI, join(node.osHome, "no-service"));
    expect(await untouched.needsRepair()).toBe(false);
  });

  it("lists provider keys that only live in the shell", async () => {
    const node = createTestNode({ env: { PATH: "/usr/bin", OPENAI_API_KEY: "sk-x" } });
    const warnings = await createServiceManager(node.context, CLI, node.tauHome).install();
    expect(warnings.join(" ")).toContain("OPENAI_API_KEY");
    expect(warnings.join(" ")).toContain("Settings → Providers");
  });

  it("reports state from launchctl print", async () => {
    const node = createTestNode({}, (line) =>
      line.startsWith("launchctl print gui/501/") ? { stdout: "state = running\n\tpid = 321\n" } : undefined,
    );
    const manager = createServiceManager(node.context, CLI, node.tauHome);
    await manager.install();
    expect(await manager.state()).toMatchObject({ active: true, pid: 321, kind: "launchd" });
  });
});

describe("Linux (systemd user unit)", () => {
  const unitOf = (osHome: string) => join(osHome, ".config", "systemd", "user", "tau.service");

  it("enables the unit now and turns on linger", async () => {
    const node = createTestNode({ platform: "linux" });
    const warnings = await createServiceManager(node.context, CLI, node.tauHome).install();
    expect(node.runner.calls).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable --now tau.service",
      "loginctl enable-linger pablo",
    ]);
    expect(warnings).toEqual([]);
    expect(readFileSync(unitOf(node.osHome), "utf8")).toContain("Restart=always");
  });

  it("warns when linger fails", async () => {
    const node = createTestNode({ platform: "linux" }, (line) =>
      line.startsWith("loginctl") ? { code: 1 } : undefined,
    );
    const warnings = await createServiceManager(node.context, CLI, node.tauHome).install();
    expect(warnings.join(" ")).toContain("linger");
  });

  it("runs detached with a warning when there is no XDG_RUNTIME_DIR", async () => {
    const node = createTestNode({ platform: "linux", xdgRuntimeDir: undefined });
    const warnings = await createServiceManager(node.context, CLI, node.tauHome).install();
    expect(warnings.join(" ")).toContain("will not survive a reboot");
    expect(node.runner.detached).toHaveLength(1);
    expect(node.runner.calls).toEqual([]);
    expect(existsSync(unitOf(node.osHome))).toBe(false);
  });

  it("falls back to detached when systemctl --user daemon-reload fails", async () => {
    const node = createTestNode({ platform: "linux" }, (line) =>
      line.startsWith("systemctl") ? { code: 1 } : undefined,
    );
    const warnings = await createServiceManager(node.context, CLI, node.tauHome).install();
    expect(warnings.join(" ")).toContain("will not survive a reboot");
    expect(node.runner.detached).toHaveLength(1);
    expect(existsSync(unitOf(node.osHome))).toBe(false);
  });

  it("stops and restarts through systemctl --user", async () => {
    const node = createTestNode({ platform: "linux" });
    const manager = createServiceManager(node.context, CLI, node.tauHome);
    await manager.install();
    node.runner.calls.length = 0;
    await manager.stop();
    await manager.start();
    await manager.restart();
    expect(node.runner.calls).toEqual([
      "systemctl --user stop tau.service",
      "systemctl --user start tau.service",
      "systemctl --user restart tau.service",
    ]);
  });
});

describe("Windows (Task Scheduler)", () => {
  it("creates the task from XML and a .cmd wrapper with PATH", async () => {
    const node = createTestNode({ platform: "win32", env: { PATH: "C:\\bin" } });
    await createServiceManager(node.context, CLI, node.tauHome).install();
    const xmlPath = join(node.tauHome, "bin", "tau.xml");
    expect(node.runner.calls).toContain(`schtasks /create /tn tau /xml ${xmlPath} /f`);
    expect(node.runner.calls).toContain("schtasks /run /tn tau");
    expect(readFileSync(xmlPath).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
    expect(readFileSync(join(node.tauHome, "bin", "tau-service.cmd"), "utf8")).toContain('set "PATH=');
  });

  it("uses the detached fallback before Windows 10 1809", async () => {
    const node = createTestNode({ platform: "win32", windowsBuild: 17134 });
    await createServiceManager(node.context, CLI, node.tauHome).install();
    expect(node.runner.calls).toEqual([]);
    expect(node.runner.detached).toHaveLength(1);
  });
});

describe("detached homes", () => {
  it("starts and stops a plain process for a home with no service", async () => {
    const node = createTestNode();
    const home = join(node.osHome, "tmp-home");
    const manager = createServiceManager(node.context, CLI, home);
    await manager.start();
    expect(node.runner.detached[0]).toContain(`--home ${home}`);
    expect(await manager.state()).toMatchObject({ active: true, pid: 4242, kind: "detached" });
    await manager.stop();
    expect((await manager.state()).active).toBe(false);
    expect(node.runner.calls).toEqual([]);
  });

  it("renders byte-identical files after a `current` swap, so restart never reloads", async () => {
    const root = mkdtempSync(join(tmpdir(), "tau-root-"));
    for (const version of ["1.0.0", "1.1.0"]) {
      mkdirSync(join(root, "versions", version), { recursive: true });
      writeFileSync(join(root, "versions", version, "tau"), "");
    }
    const node = createTestNode();
    const cli = { command: join(root, "current", "tau"), args: [] };
    swapCurrent(root, "1.0.0");
    const before = buildSpec(node.context, cli, node.tauHome);
    swapCurrent(root, "1.1.0");
    const after = buildSpec(node.context, cli, node.tauHome);
    expect(after).toEqual(before);
    expect(renderPlist(after)).toBe(renderPlist(before));
    expect(renderSystemdUnit(after)).toBe(renderSystemdUnit(before));
    expect(before.args).toEqual(["serve", "--service", "--no-open"]);
  });
});
