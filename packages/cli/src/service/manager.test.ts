import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TemporaryEntryError } from "./entry-guard";
import { createServiceManager, listServices } from "./manager";
import { CLI, createTestMachine } from "./test-context";

const plistOf = (osHome: string, label = "dev.tau.server") =>
  join(osHome, "Library", "LaunchAgents", `${label}.plist`);

describe("macOS (launchd)", () => {
  it("installs with bootout then bootstrap into gui/<uid>", async () => {
    const machine = createTestMachine();
    const manager = createServiceManager(machine.context, CLI, machine.tauHome);
    await manager.install();
    expect(machine.runner.calls).toContain("launchctl bootout gui/501/dev.tau.server");
    const bootstrap = `launchctl bootstrap gui/501 ${plistOf(machine.osHome)}`;
    expect(machine.runner.calls.indexOf(bootstrap)).toBeGreaterThan(
      machine.runner.calls.indexOf("launchctl bootout gui/501/dev.tau.server"),
    );
    expect(readFileSync(plistOf(machine.osHome), "utf8")).toContain("<key>KeepAlive</key>");
  });

  it("uses user/<uid> when there is no GUI session", async () => {
    const machine = createTestMachine({}, (line) =>
      line.includes(" gui/501") ? { code: 1, stderr: "no gui" } : undefined,
    );
    await createServiceManager(machine.context, CLI, machine.tauHome).install();
    expect(machine.runner.calls).toContain(`launchctl bootstrap user/501 ${plistOf(machine.osHome)}`);
    expect(machine.runner.detached).toEqual([]);
  });

  it("falls back to a detached process with a warning when launchd refuses both", async () => {
    const machine = createTestMachine({}, (line) =>
      line.startsWith("launchctl") ? { code: 1, stderr: "denied" } : undefined,
    );
    const warnings = await createServiceManager(machine.context, CLI, machine.tauHome).install();
    expect(warnings.join(" ")).toContain("detached");
    expect(machine.runner.detached).toEqual([`${CLI.node} ${CLI.entry} serve --service --no-open`]);
    expect(existsSync(plistOf(machine.osHome))).toBe(false);
  });

  it("restart is kickstart -k, start is bootstrap, stop is bootout", async () => {
    const machine = createTestMachine();
    const manager = createServiceManager(machine.context, CLI, machine.tauHome);
    await manager.install();
    machine.runner.calls.length = 0;
    await manager.restart();
    await manager.stop();
    await manager.start();
    expect(machine.runner.calls).toContain("launchctl kickstart -k gui/501/dev.tau.server");
    expect(machine.runner.calls).toContain("launchctl bootout gui/501/dev.tau.server");
    expect(machine.runner.calls).toContain(`launchctl bootstrap gui/501 ${plistOf(machine.osHome)}`);
  });

  it("restart copies PATH again and reloads the job when it changed", async () => {
    const machine = createTestMachine();
    await createServiceManager(machine.context, CLI, machine.tauHome).install();
    const changed = { ...machine.context, env: { PATH: "/new/bin:/usr/bin" } };
    machine.runner.calls.length = 0;
    await createServiceManager(changed, CLI, machine.tauHome).restart();
    expect(readFileSync(plistOf(machine.osHome), "utf8")).toContain("/new/bin");
    expect(machine.runner.calls.some((call) => call.includes("kickstart"))).toBe(false);
    expect(machine.runner.calls.some((call) => call.includes("bootstrap"))).toBe(true);
  });

  it("gives a non-default home its own label and leaves the user's service alone", async () => {
    const machine = createTestMachine();
    const dev = createServiceManager(machine.context, CLI, join(machine.osHome, "dev-home"));
    await dev.install();
    expect(dev.spec.names.launchdLabel).not.toBe("dev.tau.server");
    expect(existsSync(plistOf(machine.osHome))).toBe(false);
    expect(await listServices(machine.context)).toEqual([dev.spec.names.launchdLabel]);
    await dev.uninstall();
    expect(await listServices(machine.context)).toEqual([]);
  });

  it("repairs when the recorded node or entry is not the current one", async () => {
    const machine = createTestMachine();
    await createServiceManager(machine.context, CLI, machine.tauHome).install();
    const same = createServiceManager(machine.context, CLI, machine.tauHome);
    expect(await same.needsRepair()).toBe(false);
    const moved = createServiceManager(machine.context, { ...CLI, node: "/new/node" }, machine.tauHome);
    expect(await moved.needsRepair()).toBe(true);
    const untouched = createServiceManager(machine.context, CLI, join(machine.osHome, "no-service"));
    expect(await untouched.needsRepair()).toBe(false);
  });

  it("refuses an entry inside an npx cache", async () => {
    const machine = createTestMachine();
    const cache = { ...CLI, entry: "/h/.npm/_npx/1/node_modules/tau/dist/bin.js" };
    await expect(createServiceManager(machine.context, cache, machine.tauHome).install()).rejects.toThrow(
      TemporaryEntryError,
    );
    expect(machine.runner.calls).toEqual([]);
  });

  it("lists provider keys that only live in the shell", async () => {
    const machine = createTestMachine({ env: { PATH: "/usr/bin", OPENAI_API_KEY: "sk-x" } });
    const warnings = await createServiceManager(machine.context, CLI, machine.tauHome).install();
    expect(warnings.join(" ")).toContain("OPENAI_API_KEY");
    expect(warnings.join(" ")).toContain("Settings → Providers");
  });

  it("reports state from launchctl print", async () => {
    const machine = createTestMachine({}, (line) =>
      line.startsWith("launchctl print gui/501/") ? { stdout: "state = running\n\tpid = 321\n" } : undefined,
    );
    const manager = createServiceManager(machine.context, CLI, machine.tauHome);
    await manager.install();
    expect(await manager.state()).toMatchObject({ active: true, pid: 321, kind: "launchd" });
  });
});

describe("Linux (systemd user unit)", () => {
  const unitOf = (osHome: string) => join(osHome, ".config", "systemd", "user", "tau.service");

  it("enables the unit now and turns on linger", async () => {
    const machine = createTestMachine({ platform: "linux" });
    const warnings = await createServiceManager(machine.context, CLI, machine.tauHome).install();
    expect(machine.runner.calls).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable --now tau.service",
      "loginctl enable-linger pablo",
    ]);
    expect(warnings).toEqual([]);
    expect(readFileSync(unitOf(machine.osHome), "utf8")).toContain("Restart=always");
  });

  it("warns when linger fails", async () => {
    const machine = createTestMachine({ platform: "linux" }, (line) =>
      line.startsWith("loginctl") ? { code: 1 } : undefined,
    );
    const warnings = await createServiceManager(machine.context, CLI, machine.tauHome).install();
    expect(warnings.join(" ")).toContain("linger");
  });

  it("runs detached with a warning when there is no XDG_RUNTIME_DIR", async () => {
    const machine = createTestMachine({ platform: "linux", xdgRuntimeDir: undefined });
    const warnings = await createServiceManager(machine.context, CLI, machine.tauHome).install();
    expect(warnings.join(" ")).toContain("will not survive a reboot");
    expect(machine.runner.detached).toHaveLength(1);
    expect(machine.runner.calls).toEqual([]);
    expect(existsSync(unitOf(machine.osHome))).toBe(false);
  });

  it("stops and restarts through systemctl --user", async () => {
    const machine = createTestMachine({ platform: "linux" });
    const manager = createServiceManager(machine.context, CLI, machine.tauHome);
    await manager.install();
    machine.runner.calls.length = 0;
    await manager.stop();
    await manager.start();
    await manager.restart();
    expect(machine.runner.calls).toEqual([
      "systemctl --user stop tau.service",
      "systemctl --user start tau.service",
      "systemctl --user restart tau.service",
    ]);
  });
});

describe("Windows (Task Scheduler)", () => {
  it("creates the task from XML and a .cmd wrapper with PATH", async () => {
    const machine = createTestMachine({ platform: "win32", env: { PATH: "C:\\bin" } });
    await createServiceManager(machine.context, CLI, machine.tauHome).install();
    const xmlPath = join(machine.tauHome, "bin", "tau.xml");
    expect(machine.runner.calls).toContain(`schtasks /create /tn tau /xml ${xmlPath} /f`);
    expect(machine.runner.calls).toContain("schtasks /run /tn tau");
    expect(readFileSync(xmlPath).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
    expect(readFileSync(join(machine.tauHome, "bin", "tau-service.cmd"), "utf8")).toContain('set "PATH=');
  });

  it("uses the detached fallback before Windows 10 1809", async () => {
    const machine = createTestMachine({ platform: "win32", windowsBuild: 17134 });
    await createServiceManager(machine.context, CLI, machine.tauHome).install();
    expect(machine.runner.calls).toEqual([]);
    expect(machine.runner.detached).toHaveLength(1);
  });
});

describe("detached homes", () => {
  it("starts and stops a plain process for a home with no service", async () => {
    const machine = createTestMachine();
    const home = join(machine.osHome, "tmp-home");
    const manager = createServiceManager(machine.context, CLI, home);
    await manager.start();
    expect(machine.runner.detached[0]).toContain(`--home ${home}`);
    expect(await manager.state()).toMatchObject({ active: true, pid: 4242, kind: "detached" });
    await manager.stop();
    expect((await manager.state()).active).toBe(false);
    expect(machine.runner.calls).toEqual([]);
  });
});
