import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SandboxSettings } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import type { SandboxScope } from "../../processes/governor/governed";
import type { TrustInput } from "../../processes/sandbox/trust-root";
import type { SandboxSupport } from "../../processes/sandbox/wrap";
import { useTempDir } from "../../test-support/temp-dir";
import { sandboxExecAvailable } from "../testing/offline-sandbox";
import type { LaunchSpec } from "./launch";
import {
  claudeStateWritablePaths,
  type NativeSandboxSource,
  type NativeSpawn,
  nativeLaunchPolicy,
  policyScopeOf,
} from "./launch-policy";

const tempDir = useTempDir();

const SEATBELT: SandboxSupport = { platform: "macos", binaries: { sandboxExec: "/usr/bin/sandbox-exec" } };
const SYSTEMD: SandboxSupport = { platform: "linux", binaries: { systemdRun: "/usr/bin/systemd-run" } };
const BWRAP: SandboxSupport = { platform: "linux", binaries: { bwrap: "/usr/bin/bwrap" } };
const NO_ENFORCEMENT: SandboxSupport = { platform: "macos", binaries: {} };
const ALL_OFF: SandboxSettings = { main: false, worktree: false, subagent: false };

interface Fixture {
  readonly root: string;
  readonly home: string;
  readonly tmp: string;
  readonly spawned: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv; cwd?: string }[];
}

async function fixture(): Promise<Fixture> {
  const base = await tempDir();
  const [root, home, tmp] = ["root", "home", "tmp"].map((name) => join(base, name)) as [
    string,
    string,
    string,
  ];
  for (const directory of [root, home, tmp]) mkdirSync(directory);
  return { root, home, tmp, spawned: [] };
}

const fakeSpawn =
  (fixture: Fixture): NativeSpawn =>
  (file, args, options) => {
    fixture.spawned.push({
      file,
      args,
      env: options.env,
      ...(options.cwd !== undefined && { cwd: options.cwd }),
    });
    return {} as never;
  };

interface PolicyOptions {
  readonly settings?: SandboxSettings | undefined;
  readonly scope?: SandboxScope;
  readonly trust?: TrustInput | undefined;
  readonly support?: SandboxSupport;
  readonly preferBwrap?: boolean;
}

function policyOf(world: Fixture, options: PolicyOptions = {}) {
  const sandbox: NativeSandboxSource = {
    settings: () => ("settings" in options ? options.settings : { ...ALL_OFF, main: true }),
    scopeOf: async () => options.scope ?? "main",
    trustOf: async () => ("trust" in options ? options.trust : { kind: "main", root: world.root }),
    support: () => options.support ?? SEATBELT,
    home: world.home,
    tmp: world.tmp,
    ...(options.preferBwrap !== undefined && { preferBwrap: options.preferBwrap }),
  };
  return nativeLaunchPolicy({ sandbox, spawn: fakeSpawn(world) });
}

const specIn = (
  world: Fixture,
  env: NodeJS.ProcessEnv = { HOME: world.home, TAU_RUNTIME_NONCE: "n1" },
): LaunchSpec => ({
  command: "/usr/local/bin/claude",
  args: ["--print", "--input-format", "stream-json"],
  cwd: world.root,
  env,
});

describe("native launch policy: fail closed", () => {
  it("rejects with forbidden before spawning when the sandbox is on and nothing can enforce it", async () => {
    const world = await fixture();
    const policy = policyOf(world, { support: NO_ENFORCEMENT });

    await expect(policy.plan("1", world.root)).rejects.toMatchObject({ code: "forbidden" });
    const run = policy.forThread("1", world.root);
    expect(await run.prepare()).toMatchObject({ ok: false, reason: expect.stringContaining("unsupported") });
    expect(() => run.launch(specIn(world))).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(world.spawned).toEqual([]);
  });

  it("rejects with forbidden when the thread has no trusted root", async () => {
    const world = await fixture();
    for (const trust of [
      undefined,
      { kind: "removed" as const },
      { kind: "main" as const, root: join(world.root, "gone") },
    ]) {
      const policy = policyOf(world, { trust });
      const run = policy.forThread("1", world.root);
      expect(await run.prepare()).toMatchObject({ ok: false });
      await expect(policy.plan("1", world.root)).rejects.toMatchObject({ code: "forbidden" });
      expect(() => run.launch(specIn(world))).toThrow(expect.objectContaining({ code: "forbidden" }));
    }
    expect(world.spawned).toEqual([]);
  });

  it("rejects a folder outside the trusted root, at planning and at launch", async () => {
    const world = await fixture();
    const policy = policyOf(world);

    await expect(policy.plan("1", world.home)).rejects.toMatchObject({ code: "forbidden" });
    const run = policy.forThread("1", world.root);
    expect(await run.prepare()).toEqual({ ok: true });
    expect(() => run.launch({ ...specIn(world), cwd: world.home })).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
    expect(world.spawned).toEqual([]);
  });

  it("never launches an unplanned thread, even when the sandbox is off", async () => {
    const world = await fixture();
    const run = policyOf(world, { settings: ALL_OFF }).forThread("1", world.root);
    expect(() => run.launch(specIn(world))).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(world.spawned).toEqual([]);
  });

  it("treats absent settings as the staging gate and an unknown scope as sandboxed when any scope is on", async () => {
    const world = await fixture();
    expect(await policyOf(world, { settings: undefined }).plan("1", world.root)).toEqual({ kind: "plain" });
    expect(await policyOf(world, { scope: "unknown", settings: ALL_OFF }).plan("1", world.root)).toEqual({
      kind: "plain",
    });
    const unresolved = await policyOf(world, { scope: "unknown", support: NO_ENFORCEMENT })
      .plan("1", world.root)
      .catch((e) => e);
    expect(unresolved).toMatchObject({ code: "forbidden" });
  });
});

describe("native launch policy: sandbox off", () => {
  it("spawns the plain command with the SDK's environment untouched", async () => {
    const world = await fixture();
    const env = { HOME: "/Users/real", PATH: "/usr/bin", TAU_RUNTIME_NONCE: "n1", ANTHROPIC_API_KEY: "kept" };
    const run = policyOf(world, { settings: ALL_OFF, support: NO_ENFORCEMENT }).forThread("1", world.root);

    expect(await run.prepare()).toEqual({ ok: true });
    run.launch(specIn(world, env));

    expect(world.spawned).toEqual([
      { file: "/usr/local/bin/claude", args: specIn(world).args, env, cwd: world.root },
    ]);
  });
});

describe("native launch policy: scope selection", () => {
  const cases: [SandboxScope, SandboxSettings, "plain" | "sandboxed"][] = [
    ["worktree", { main: false, worktree: true, subagent: false }, "sandboxed"],
    ["worktree", { main: true, worktree: false, subagent: false }, "plain"],
    ["main", { main: true, worktree: false, subagent: false }, "sandboxed"],
    ["main", { main: false, worktree: true, subagent: true }, "plain"],
    ["subagent", { main: false, worktree: false, subagent: true }, "sandboxed"],
    ["unknown", { main: false, worktree: true, subagent: false }, "sandboxed"],
  ];

  it.each(cases)("scope %s under %j is %s", async (scope, settings, expected) => {
    const world = await fixture();
    const trust: TrustInput = { kind: scope === "worktree" ? "worktree" : "main", root: world.root };
    const plan = await policyOf(world, { scope, settings, trust }).plan("1", world.root);
    expect(plan.kind).toBe(expected);
  });

  it("picks the first enabled scope for an unknown thread", () => {
    expect(policyScopeOf("unknown", { main: false, worktree: true, subagent: true })).toBe("worktree");
    expect(policyScopeOf("unknown", ALL_OFF)).toBeNull();
  });

  it("follows a settings change between two runs", async () => {
    const world = await fixture();
    let settings: SandboxSettings = ALL_OFF;
    const sandbox: NativeSandboxSource = {
      settings: () => settings,
      scopeOf: async () => "main",
      trustOf: async () => ({ kind: "main", root: world.root }),
      support: () => SEATBELT,
      home: world.home,
      tmp: world.tmp,
    };
    const policy = nativeLaunchPolicy({ sandbox, spawn: fakeSpawn(world) });
    const run = policy.forThread("1", world.root);
    await run.prepare();
    run.launch(specIn(world));
    settings = { ...ALL_OFF, main: true };
    await run.prepare();
    run.launch(specIn(world));

    expect(world.spawned.map((call) => call.file)).toEqual([
      "/usr/local/bin/claude",
      "/usr/bin/sandbox-exec",
    ]);
  });
});

describe("native launch policy: the enforcement path", () => {
  it("wraps the SDK child in sandbox-exec granting only the thread root and the SDK's own state", async () => {
    const world = await fixture();
    const run = policyOf(world).forThread("1", world.root);
    await run.prepare();

    run.launch(specIn(world));

    const [call] = world.spawned;
    expect(call?.file).toBe("/usr/bin/sandbox-exec");
    expect(call?.args.slice(0, 1)).toEqual(["-p"]);
    expect(call?.args.slice(2)).toEqual(["/usr/local/bin/claude", ...specIn(world).args]);
    const profile = call?.args[1] ?? "";
    for (const granted of [
      world.root,
      join(world.home, ".claude"),
      join(world.home, ".claude.json"),
      world.tmp,
    ]) {
      expect(profile).toContain(`(subpath "${granted}")`);
    }
    expect(profile).not.toContain(`(subpath "${world.home}")`);
    expect(profile).toContain("(deny file-write*)");
    expect(call?.env.HOME).toBe(world.home);
    expect(call?.env.TAU_RUNTIME_NONCE).toBe("n1");
    expect(call?.cwd).toBe(world.root);
  });

  it("grants a thread worktree its git admin directory and nothing beyond", async () => {
    const world = await fixture();
    const adminDir = join(world.tmp, "repo", ".git", "worktrees", "w1");
    mkdirSync(adminDir, { recursive: true });
    const trust: TrustInput = { kind: "worktree", root: world.root, adminDir };
    const run = policyOf(world, {
      scope: "worktree",
      settings: { ...ALL_OFF, worktree: true },
      trust,
    }).forThread("1", world.root);
    await run.prepare();
    run.launch(specIn(world));
    expect(world.spawned[0]?.args[1]).toContain(`(subpath "${adminDir}")`);
  });

  it("uses a systemd service with the same grants, leaving temp to the service's private one", async () => {
    const world = await fixture();
    mkdirSync(join(world.home, ".claude"));
    const run = policyOf(world, { support: SYSTEMD, preferBwrap: false }).forThread("1", world.root);
    await run.prepare();

    run.launch(specIn(world));

    const [call] = world.spawned;
    expect(call?.file).toBe("/usr/bin/systemd-run");
    const args = call?.args ?? [];
    expect(args).toContain(`--property=ReadWritePaths=${world.root}`);
    expect(args).toContain(`--property=ReadWritePaths=${join(world.home, ".claude")}`);
    expect(args).not.toContain(`--property=ReadWritePaths=${world.tmp}`);
    expect(args).not.toContain(`--property=ReadWritePaths=${join(world.home, ".claude.json")}`);
    expect(args).toContain("--property=ProtectHome=read-only");
    expect(args.some((arg) => arg.startsWith("--unit=tau-native-1-n1"))).toBe(true);
    expect(args.slice(-4)).toEqual(["/usr/local/bin/claude", ...specIn(world).args]);
    expect(args).toContain(`--setenv=HOME=${world.home}`);
  });

  it("prefers bwrap by default so a killed client takes the sandbox with it", async () => {
    const world = await fixture();
    writeFileSync(join(world.home, ".claude.json"), "{}");
    const both: SandboxSupport = {
      platform: "linux",
      binaries: { systemdRun: "/usr/bin/systemd-run", bwrap: "/usr/bin/bwrap" },
    };
    const run = policyOf(world, { support: both }).forThread("1", world.root);
    await run.prepare();

    run.launch(specIn(world));

    const [call] = world.spawned;
    expect(call?.file).toBe("/usr/bin/bwrap");
    const args = call?.args ?? [];
    expect(args).toEqual(expect.arrayContaining(["--die-with-parent", "--bind", world.root, world.root]));
    expect(args.join(" ")).toContain(
      `--bind ${join(world.home, ".claude.json")} ${join(world.home, ".claude.json")}`,
    );
    expect(args.join(" ")).toContain(`--bind ${world.tmp} ${world.tmp}`);
    expect(args.join(" ")).not.toContain(`--bind ${world.home} ${world.home}`);
  });

  it("works with bwrap alone", async () => {
    const world = await fixture();
    const run = policyOf(world, { support: BWRAP }).forThread("1", world.root);
    expect(await run.prepare()).toEqual({ ok: true });
  });
});

describe("claude state grants", () => {
  it("lists the state directory, its file and temp on seatbelt, existing or not", () => {
    expect(claudeStateWritablePaths({ home: "/h", tmp: "/t", backend: "seatbelt" })).toEqual([
      "/h/.claude",
      "/h/.claude.json",
      "/t",
    ]);
  });

  it("drops paths that do not exist where a bind needs them", async () => {
    const world = await fixture();
    expect(claudeStateWritablePaths({ home: world.home, tmp: world.tmp, backend: "bwrap" })).toEqual([
      world.tmp,
    ]);
  });
});

const exitCodeOf = (child: { once(event: "exit", listener: (code: number | null) => void): unknown }) =>
  new Promise<number | null>((resolve) => child.once("exit", resolve));

describe.skipIf(!sandboxExecAvailable())("native launch policy under the real sandbox-exec", () => {
  async function touchedUnderPolicy(world: Fixture, path: string): Promise<boolean> {
    const policy = nativeLaunchPolicy({
      sandbox: {
        settings: () => ({ ...ALL_OFF, main: true }),
        scopeOf: async () => "main",
        trustOf: async () => ({ kind: "main", root: world.root }),
        home: world.home,
        tmp: world.tmp,
      },
    });
    const run = policy.forThread("1", world.root);
    expect(await run.prepare()).toEqual({ ok: true });
    const child = run.launch({
      command: "/usr/bin/touch",
      args: [path],
      cwd: world.root,
      env: { PATH: "/usr/bin" },
    });
    const code = await exitCodeOf(child);
    return code === 0 && existsSync(path);
  }

  it("writes only to the thread root, the SDK state and temp", async () => {
    const world = await fixture();
    mkdirSync(join(world.home, ".claude"));
    const granted = [
      join(world.root, "inside.txt"),
      join(world.home, ".claude", "session.jsonl"),
      join(world.home, ".claude.json"),
      join(world.tmp, "scratch.txt"),
    ];
    const denied = [
      join(world.home, "elsewhere.txt"),
      join(world.home, ".claude.json.tmp"),
      join(world.home, ".config-other"),
      join(world.root, "..", "sibling.txt"),
    ];

    for (const path of granted) expect(await touchedUnderPolicy(world, path), path).toBe(true);
    for (const path of denied) expect(await touchedUnderPolicy(world, path), path).toBe(false);
  });
});
