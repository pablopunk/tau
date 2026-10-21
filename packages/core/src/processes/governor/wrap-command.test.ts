import { spawnSync } from "node:child_process";
import type { ResourcePriority } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { BACKGROUND_CHRT, findOnPath, type WrapSupport, wrapCommand } from "./wrap-command";

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
const base = {
  shell: "/bin/bash",
  command: "pnpm test",
  priority: "off" as ResourcePriority,
  memoryLimitMb: 4096,
};

describe("wrapCommand", () => {
  it("is null when nothing needs wrapping", () => {
    expect(wrapCommand({ ...base, support: mac })).toBeNull();
  });

  it("uses taskpolicy on macOS", () => {
    expect(wrapCommand({ ...base, priority: "balanced", support: mac })).toEqual({
      file: "/usr/sbin/taskpolicy",
      args: ["-c", "utility", "/bin/bash", "-c", "pnpm test"],
    });
    expect(wrapCommand({ ...base, priority: "background", support: mac })?.args).toEqual([
      "-b",
      "/bin/bash",
      "-c",
      "pnpm test",
    ]);
  });

  it("uses nice on Linux and the chrt-to-nice fallback for background", () => {
    expect(wrapCommand({ ...base, priority: "balanced", support: linux })).toEqual({
      file: "/usr/bin/nice",
      args: ["-n", "5", "/bin/bash", "-c", "pnpm test"],
    });
    const background = wrapCommand({ ...base, priority: "background", support: linux });
    expect(background?.file).toBe("/bin/sh");
    expect(background?.args[1]).toBe(BACKGROUND_CHRT);
    expect(background?.args.slice(2)).toEqual([
      "_",
      "chrt",
      "/usr/bin/nice",
      "/bin/sh",
      "/bin/bash",
      "-c",
      "pnpm test",
    ]);
  });

  it("passes absolute chrt and nice to the background wrapper", () => {
    const support = { ...linux, binaries: { ...linux.binaries, chrt: "/usr/bin/chrt" } };
    const wrapped = wrapCommand({ ...base, priority: "background", support });
    expect(wrapped?.args.slice(2, 6)).toEqual(["_", "/usr/bin/chrt", "/usr/bin/nice", "/bin/sh"]);
  });

  it("uses a scope for the memory limit on Linux with cgroup support", () => {
    const wrapped = wrapCommand({ ...base, priority: "balanced", support: linux, unit: "tau-abc-1" });
    expect(wrapped?.file).toBe("/usr/bin/systemd-run");
    expect(wrapped?.args).toEqual([
      "--user",
      "--scope",
      "--quiet",
      "--unit=tau-abc-1",
      "-p",
      "MemoryMax=4096M",
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
    expect(wrapCommand({ ...base, support: basic, unit: "u" })).toBeNull();
  });
});

describe("findOnPath", () => {
  it("adds /usr/bin and /bin to a short PATH", () => {
    expect(findOnPath("sh", "/nonexistent")).toMatch(/\/(usr\/)?bin\/sh$/);
  });
});

describe("background wrapper, really run", () => {
  const real: WrapSupport = {
    platform: "linux",
    binaries: { nice: "/usr/bin/nice", sh: "/bin/sh", chrt: "/nonexistent/chrt" },
    cgroupMemory: false,
  };

  it("falls back to nice, keeps the exit code and the pid", () => {
    const wrapped = wrapCommand({
      shell: "/bin/sh",
      command: 'echo "pid=$$"; exit 3',
      priority: "background",
      memoryLimitMb: 4096,
      support: real,
    });
    const run = spawnSync(wrapped?.file ?? "", [...(wrapped?.args ?? [])], { encoding: "utf8" });
    expect(run.status).toBe(3);
    expect(run.stdout).toMatch(/^pid=\d+\n$/);
  });
});
