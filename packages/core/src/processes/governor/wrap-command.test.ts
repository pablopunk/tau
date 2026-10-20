import { DEFAULT_RESOURCE_SETTINGS, type ResourceSettings } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { findOnPath, type WrapSupport, wrapCommand } from "./wrap-command";

const settings = (patch: Partial<ResourceSettings>): ResourceSettings => ({
  ...DEFAULT_RESOURCE_SETTINGS,
  ...patch,
});
const mac: WrapSupport = {
  platform: "macos",
  binaries: { taskpolicy: "/usr/sbin/taskpolicy" },
  cgroupMemory: false,
};
const linux: WrapSupport = {
  platform: "linux",
  binaries: { nice: "/usr/bin/nice", sh: "/bin/sh", systemdRun: "/usr/bin/systemd-run" },
  cgroupMemory: true,
};
const base = { shell: "/bin/bash", command: "pnpm test" };

describe("wrapCommand", () => {
  it("is null when nothing needs wrapping", () => {
    expect(wrapCommand({ ...base, settings: DEFAULT_RESOURCE_SETTINGS, support: mac })).toBeNull();
    expect(wrapCommand({ ...base, settings: settings({ heavySlots: 2 }), support: linux })).toBeNull();
    expect(wrapCommand({ ...base, settings: settings({ memoryLimitMb: 512 }), support: mac })).toBeNull();
  });

  it("uses taskpolicy on macOS", () => {
    expect(wrapCommand({ ...base, settings: settings({ priority: "balanced" }), support: mac })).toEqual({
      file: "/usr/sbin/taskpolicy",
      args: ["-c", "utility", "/bin/bash", "-c", "pnpm test"],
    });
    expect(
      wrapCommand({ ...base, settings: settings({ priority: "background" }), support: mac })?.args,
    ).toEqual(["-b", "/bin/bash", "-c", "pnpm test"]);
  });

  it("uses nice on Linux and the chrt-to-nice fallback for background", () => {
    expect(wrapCommand({ ...base, settings: settings({ priority: "balanced" }), support: linux })).toEqual({
      file: "/usr/bin/nice",
      args: ["-n", "5", "/bin/bash", "-c", "pnpm test"],
    });
    const background = wrapCommand({
      ...base,
      settings: settings({ priority: "background" }),
      support: linux,
    });
    expect(background?.file).toBe("/bin/sh");
    expect(background?.args[1]).toBe(
      'chrt -i 0 true 2>/dev/null && exec chrt -i 0 "$@" || exec nice -n 19 "$@"',
    );
    expect(background?.args.slice(2)).toEqual(["_", "/bin/bash", "-c", "pnpm test"]);
  });

  it("uses a scope for the memory limit on Linux with cgroup support", () => {
    const wrapped = wrapCommand({
      ...base,
      settings: settings({ memoryLimitMb: 512, priority: "balanced" }),
      support: linux,
      unit: "tau-abc-1",
    });
    expect(wrapped?.file).toBe("/usr/bin/systemd-run");
    expect(wrapped?.args).toEqual([
      "--user",
      "--scope",
      "--quiet",
      "--unit=tau-abc-1",
      "-p",
      "MemoryMax=512M",
      "-p",
      "MemorySwapMax=0",
      "--",
      "/usr/bin/nice",
      "-n",
      "5",
      "/bin/bash",
      "-c",
      "pnpm test",
    ]);
  });

  it("falls back to the basic wrapper without cgroup support", () => {
    const basic = { ...linux, cgroupMemory: false };
    expect(
      wrapCommand({ ...base, settings: settings({ memoryLimitMb: 512 }), support: basic, unit: "u" }),
    ).toBeNull();
  });
});

describe("findOnPath", () => {
  it("adds /usr/bin and /bin to a short PATH", () => {
    expect(findOnPath("sh", "/nonexistent")).toMatch(/\/(usr\/)?bin\/sh$/);
  });
});
