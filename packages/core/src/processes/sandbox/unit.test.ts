import { describe, expect, it, vi } from "vitest";
import type { Exec } from "../governor/exec";
import {
  buildBwrapPrefix,
  buildSystemdSandboxPrefix,
  cacheEnvAdditions,
  gitSshCommand,
  listSandboxUnitPids,
  serviceUnit,
  stopSandboxUnit,
} from "./unit";

describe("cacheEnvAdditions", () => {
  it("redirects pnpm, cargo and mise caches into the worktree", () => {
    expect(cacheEnvAdditions("/wt")).toEqual({
      PNPM_STORE_DIR: "/wt/.tau-caches/pnpm-store",
      CARGO_TARGET_DIR: "/wt/.tau-caches/cargo-target",
      MISE_DATA_DIR: "/wt/.tau-caches/mise-data",
      MISE_CACHE_DIR: "/wt/.tau-caches/mise-cache",
    });
  });
});

describe("gitSshCommand", () => {
  it("defaults to ssh with a worktree known_hosts file", () => {
    expect(gitSshCommand("/wt")).toBe("ssh -o UserKnownHostsFile=/wt/.tau-caches/known_hosts");
    expect(gitSshCommand("/wt", "ssh -p 2222")).toBe(
      "ssh -p 2222 -o UserKnownHostsFile=/wt/.tau-caches/known_hosts",
    );
  });

  it("leaves an explicit UserKnownHostsFile alone", () => {
    expect(gitSshCommand("/wt", "ssh -o UserKnownHostsFile=/x")).toBe("ssh -o UserKnownHostsFile=/x");
  });
});

describe("serviceUnit", () => {
  it("suffixes .service and refuses hostile names", () => {
    expect(serviceUnit("tau-abc-1")).toBe("tau-abc-1.service");
    expect(serviceUnit("tau-abc-1.service")).toBe("tau-abc-1.service");
    expect(() => serviceUnit("a/b")).toThrow();
    expect(() => serviceUnit("a b")).toThrow();
    expect(() => serviceUnit("")).toThrow();
  });
});

describe("buildSystemdSandboxPrefix", () => {
  const base = {
    systemdRun: "/usr/bin/systemd-run",
    root: "/wt",
    unit: "tau-abc-1",
    workingDirectory: "/wt",
  };

  it("is golden: strict confinement, working directory, env allowlist", () => {
    const prefix = buildSystemdSandboxPrefix(base);
    expect(prefix.file).toBe("/usr/bin/systemd-run");
    expect(prefix.args).toEqual([
      "--user",
      "--pipe",
      "--wait",
      "--collect",
      "--unit=tau-abc-1.service",
      "--working-directory=/wt",
      "--property=ProtectSystem=strict",
      "--property=ProtectHome=read-only",
      "--property=ReadWritePaths=/wt",
      "--property=ReadWritePaths=/wt/.tau-caches",
      "--property=PrivateTmp=yes",
      "--setenv=PNPM_STORE_DIR=/wt/.tau-caches/pnpm-store",
      "--setenv=CARGO_TARGET_DIR=/wt/.tau-caches/cargo-target",
      "--setenv=MISE_DATA_DIR=/wt/.tau-caches/mise-data",
      "--setenv=MISE_CACHE_DIR=/wt/.tau-caches/mise-cache",
      "--setenv=GIT_SSH_COMMAND=ssh -o UserKnownHostsFile=/wt/.tau-caches/known_hosts",
      "--",
    ]);
  });

  it("carries admin paths, the SSH socket bind-mount and request env", () => {
    const prefix = buildSystemdSandboxPrefix({
      ...base,
      adminPaths: ["/main/.git/objects"],
      sshSocket: "/tmp/ssh-AAA/agent.1",
      env: { FOO: "bar", MISE_DATA_DIR: "/custom" },
    });
    expect(prefix.args).toContain("--property=ReadWritePaths=/main/.git/objects");
    expect(prefix.args).toContain("--property=BindReadOnlyPaths=/tmp/ssh-AAA/agent.1");
    expect(prefix.args).toContain("--setenv=SSH_AUTH_SOCK=/tmp/ssh-AAA/agent.1");
    expect(prefix.args).toContain("--setenv=FOO=bar");
    // The request's deliberate value wins over the cache default.
    expect(prefix.args).toContain("--setenv=MISE_DATA_DIR=/custom");
    expect(prefix.args.at(-1)).toBe("--");
  });

  it("keeps spaces and quotes intact as single argv entries", () => {
    const prefix = buildSystemdSandboxPrefix({
      ...base,
      root: '/wt/my work\\"odd',
      workingDirectory: '/wt/my work\\"odd/sub',
    });
    expect(prefix.args).toContain('--working-directory=/wt/my work\\"odd/sub');
    expect(prefix.args).toContain('--property=ReadWritePaths=/wt/my work\\"odd');
  });
});

describe("buildBwrapPrefix", () => {
  it("binds the root writable, the rest read-only, keeps outer PIDs stable", () => {
    const prefix = buildBwrapPrefix({ bwrap: "/usr/bin/bwrap", root: "/wt" });
    expect(prefix.file).toBe("/usr/bin/bwrap");
    expect(prefix.args).toContain("/");
    expect(prefix.args).toEqual(
      expect.arrayContaining(["--ro-bind", "/", "/", "--bind", "/wt", "/wt", "--die-with-parent", "--"]),
    );
    expect(prefix.args).not.toContain("--unshare-pid");
    expect(prefix.args.at(-1)).toBe("--");
  });
});

describe("stopSandboxUnit", () => {
  const calls: string[][] = [];
  const exec = (async (_file: string, args: readonly string[]) => {
    calls.push([_file, ...args]);
    return { code: 0, stdout: "", stderr: "", timedOut: false };
  }) as Exec;

  it("stops, then kills, the unit explicitly", async () => {
    calls.length = 0;
    await stopSandboxUnit(exec, "tau-abc-1", "stop");
    expect(calls).toEqual([["systemctl", "--user", "stop", "tau-abc-1.service"]]);
    await stopSandboxUnit(exec, "tau-abc-1", "kill");
    expect(calls[1]).toEqual(["systemctl", "--user", "kill", "tau-abc-1.service", "--signal=SIGKILL"]);
  });

  it("never throws: reaping paths stay best-effort", async () => {
    const failing = (async () => {
      throw new Error("no bus");
    }) as Exec;
    await expect(stopSandboxUnit(failing, "tau-abc-1")).resolves.toBeUndefined();
  });
});

describe("listSandboxUnitPids", () => {
  it("unions MainPID with the ControlGroup walk", async () => {
    const exec = (async () => ({
      code: 0,
      stdout: "MainPID=4242\nControlGroup=/user.slice/unit.service\n",
      stderr: "",
      timedOut: false,
    })) as Exec;
    const read = vi.fn(async () => [4242, 4243]);
    expect(await listSandboxUnitPids(exec, "u", read)).toEqual([4242, 4243]);
    expect(read).toHaveBeenCalledWith("/user.slice/unit.service");
  });

  it("is empty when the unit is gone", async () => {
    const exec = (async () => {
      throw new Error("gone");
    }) as Exec;
    await expect(listSandboxUnitPids(exec, "u", async () => [1])).resolves.toEqual([]);
  });
});
