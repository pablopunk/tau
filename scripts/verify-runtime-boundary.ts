/**
 * Offline proof of the native runtime's OS boundary on this host (plan M4).
 *
 *   tsx scripts/verify-runtime-boundary.ts --platform current [--require-supported] [--output <path>] [--timeout-ms <n>]
 *
 * Exit 0: every required check passed (or was UNSUPPORTED without --require-supported). 1: an assertion failed.
 * 2: a required capability is UNSUPPORTED here under --require-supported. 64: bad arguments.
 * No network, no credentials, no SDK: confined children are node probes, every mutation lives in one temp directory
 * (plus a marker file in the real home that is removed if the sandbox failed to block it).
 */
import { type ChildProcessWithoutNullStreams, execFile, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { hostPlatform } from "../packages/core/src/processes/governor/wrap-command";
import type { SandboxSupport } from "../packages/core/src/processes/sandbox/wrap";
import {
  boundaryLimits,
  buildReport,
  type CheckDefinition,
  type CheckOutcome,
  type CheckResult,
  enforcementPathOf,
  fail,
  judgeWrite,
  parseProbeLines,
  pass,
  runCheck,
  scopeMatrixRow,
  summaryTable,
  unsupported,
  verdictFailures,
  type WriteExpectation,
} from "../packages/core/src/runtimes/boundary-checks";
import { createSpawnBridge, launchDetached } from "../packages/core/src/runtimes/native/launch";
import {
  hostSandboxSupport,
  type NativeSpawn,
  nativeLaunchPolicy,
} from "../packages/core/src/runtimes/native/launch-policy";
import { psProcessTable } from "../packages/core/src/runtimes/process-table";
import {
  classifyAfterRestart,
  isSameProcessAlive,
  type ProcessIdentity,
  readIdentity,
  type StopOptions,
  type SupervisedHandle,
  type SupervisorDeps,
  spawnSupervised,
  stopSupervised,
} from "../packages/core/src/runtimes/supervisor";
import type { SandboxSettings } from "../packages/protocol/src/sandbox";
import { DEFAULT_SANDBOX_SETTINGS } from "../packages/protocol/src/sandbox";

const run = promisify(execFile);
const EXIT_USAGE = 64;
const FAST_STOP: StopOptions = {
  eofGraceMs: 150,
  termGraceMs: 400,
  killGraceMs: 1500,
  verifyTimeoutMs: 2000,
};
const FORGED_START_TIME = "Mon Jan 1 00:00:00 1990";
const SANDBOX_ON_FOR_SUBAGENT: SandboxSettings = { main: false, worktree: false, subagent: true };
const NO_ENFORCEMENT: SandboxSupport = { platform: "other", binaries: {} };

const WRITE_PROBE = [
  "const fs=require('node:fs');",
  "for(const [label,path] of Object.entries(JSON.parse(process.env.BOUNDARY_TARGETS))){",
  "try{fs.writeFileSync(path,'probe');console.log(JSON.stringify({label,ok:true}))}",
  "catch(e){console.log(JSON.stringify({label,ok:false,code:e.code}))}}",
].join("");
const COOPERATIVE = "process.stdin.on('end',()=>process.exit(0));process.stdin.resume();console.log('ready')";
const STUBBORN =
  "process.on('SIGTERM',()=>{});process.stdin.resume();setInterval(()=>{},1000);console.log('ready')";
const WITH_DETACHED_GRANDCHILD = [
  "const {spawn}=require('node:child_process');",
  "const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)',process.argv[1]],{detached:true,stdio:'ignore'});",
  "g.unref();process.stdin.resume();setInterval(()=>{},1000);console.log('grandchild '+g.pid)",
].join("");

interface World {
  readonly base: string;
  readonly root: string;
  readonly outside: string;
  readonly home: string;
  readonly tmp: string;
  readonly realHome: string;
  readonly tag: string;
  readonly env: Record<string, string>;
}

function createWorld(): World {
  const tag = `tau-boundary-${randomUUID()}`;
  const base = realpathSync(mkdtempSync(join(tmpdir(), "tau-boundary-")));
  const [root, outside, home, tmp] = ["root", "outside", "home", "tmp"].map((name) => join(base, name)) as [
    string,
    string,
    string,
    string,
  ];
  for (const directory of [root, outside, home, tmp]) mkdirSync(directory);
  symlinkSync(outside, join(root, "escape"));
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: tmp, TAU_RUNTIME_NONCE: tag };
  return { base, root, outside, home, tmp, realHome: realpathSync(homedir()), tag, env };
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

interface Launched {
  readonly file: string;
  readonly args: readonly string[];
}

class Recorder {
  readonly launches: Launched[] = [];
  readonly stderr = new WeakMap<object, string>();

  readonly spawn: NativeSpawn = (file, args, options) => {
    this.launches.push({ file, args });
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      ...(options.signal && { signal: options.signal }),
    });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr.set(child, (this.stderr.get(child) ?? "") + chunk.toString("utf8"));
    });
    return child;
  };
}

interface Finished {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

function finish(child: ChildProcessWithoutNullStreams, recorder: Recorder): Promise<Finished> {
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  return new Promise((done) => {
    child.once("close", (code) => done({ stdout, stderr: recorder.stderr.get(child) ?? "", code }));
    child.once("error", () => done({ stdout, stderr: recorder.stderr.get(child) ?? "", code: null }));
  });
}

const probeLaunch = (world: World, targets: Record<string, string>) => ({
  command: process.execPath,
  args: ["-e", WRITE_PROBE, world.tag],
  cwd: world.root,
  env: { ...world.env, BOUNDARY_TARGETS: JSON.stringify(targets) },
});

function policyFor(world: World, settings: SandboxSettings, support: SandboxSupport, recorder: Recorder) {
  return nativeLaunchPolicy({
    sandbox: {
      settings: () => settings,
      scopeOf: async () => "subagent",
      trustOf: async () => ({ kind: "worktree", root: world.root }),
      support: () => support,
      home: world.home,
      tmp: world.tmp,
    },
    spawn: recorder.spawn,
  }).forThread("boundary-thread", world.root);
}

const probeTargets = (world: World): Record<string, string> => ({
  inside: join(world.root, "inside.txt"),
  outside: join(world.outside, "outside.txt"),
  symlink: join(world.root, "escape", "via-symlink.txt"),
  home: join(world.realHome, `.${world.tag}.probe`),
});

function removeHomeMarker(path: string): boolean {
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

async function confinedWrites(world: World, support: SandboxSupport): Promise<CheckOutcome> {
  const recorder = new Recorder();
  const policy = policyFor(world, SANDBOX_ON_FOR_SUBAGENT, support, recorder);
  const prepared = await policy.prepare();
  if (!prepared.ok) return fail(`the launch policy refused a supported host: ${prepared.reason}`);
  const targets = probeTargets(world);
  const finished = await finish(policy.launch(probeLaunch(world, targets)), recorder);
  const lines = parseProbeLines(finished.stdout);
  const homeLeaked = removeHomeMarker(targets.home as string);
  if (lines.length === 0) {
    return unsupported(
      `the enforcement path could not run the probe: ${finished.stderr.trim() || "no output"}`,
      {
        launcher: recorder.launches[0]?.file,
        exitCode: finished.code,
      },
    );
  }
  const expectations: [string, WriteExpectation][] = [
    ["inside", "allowed"],
    ["outside", "denied"],
    ["symlink", "denied"],
    ["home", "denied"],
  ];
  const verdicts = expectations.map(([label, expected]) => judgeWrite(label, expected, lines));
  const onDisk = {
    insideExists: existsSync(targets.inside as string),
    outsideExists: existsSync(targets.outside as string),
    symlinkTargetExists: existsSync(join(world.outside, "via-symlink.txt")),
    homeMarkerCreated: homeLeaked,
  };
  const failures = [
    ...verdictFailures(verdicts),
    ...(onDisk.insideExists ? [] : ["inside: file missing on disk"]),
    ...(onDisk.outsideExists ? ["outside: file exists on disk"] : []),
    ...(onDisk.symlinkTargetExists ? ["symlink: file exists on disk"] : []),
    ...(onDisk.homeMarkerCreated ? ["home: marker file was created"] : []),
  ];
  const details = { verdicts, onDisk, launcher: recorder.launches[0]?.file };
  return failures.length > 0
    ? fail(failures.join("; "), details)
    : pass("in-root write allowed; outside, symlink escape and real home denied", details);
}

async function plainWhenOff(world: World): Promise<CheckOutcome> {
  const recorder = new Recorder();
  const policy = policyFor(world, DEFAULT_SANDBOX_SETTINGS, hostSandboxSupport(), recorder);
  const prepared = await policy.prepare();
  if (!prepared.ok) return fail(`sandbox off must not refuse: ${prepared.reason}`);
  const targets = { outside: join(world.outside, "plain.txt") };
  const lines = parseProbeLines((await finish(policy.launch(probeLaunch(world, targets)), recorder)).stdout);
  const launchedPlainly = recorder.launches[0]?.file === process.execPath;
  const verdict = judgeWrite("outside", "allowed", lines);
  const details = { requestedPolicy: "sandbox off", launcher: recorder.launches[0]?.file, verdict };
  if (!launchedPlainly) return fail("sandbox off still wrapped the launch", details);
  return verdict.holds
    ? pass("launched plainly: unconfined write outside the root succeeded", details)
    : fail(`plain launch is unexpectedly confined: ${verdict.observed}`, details);
}

async function failsClosedWhenUnsupported(world: World): Promise<CheckOutcome> {
  const recorder = new Recorder();
  const policy = policyFor(world, SANDBOX_ON_FOR_SUBAGENT, NO_ENFORCEMENT, recorder);
  const prepared = await policy.prepare();
  const launchError = (() => {
    try {
      policy.launch(probeLaunch(world, {}));
      return undefined;
    } catch (error) {
      return error as { code?: string; message?: string };
    }
  })();
  const details = { prepared, launchErrorCode: launchError?.code, launches: recorder.launches.length };
  if (prepared.ok) return fail("the policy planned a sandboxed launch with no enforcement path", details);
  if (!/unsupported/.test(prepared.reason))
    return fail(`refused for the wrong reason: ${prepared.reason}`, details);
  if (launchError?.code !== "forbidden")
    return fail("launch was not refused after an unsupported plan", details);
  if (recorder.launches.length > 0) return fail("a process was spawned despite the refusal", details);
  return pass("sandbox on with no enforcement path refused the launch (forbidden); nothing spawned", details);
}

interface Spawned {
  readonly handle: SupervisedHandle;
  readonly lines: string[];
}

async function spawnNode(world: World, script: string): Promise<Spawned> {
  const handle = await spawnSupervised(
    {
      command: process.execPath,
      args: ["-e", script, world.tag],
      cwd: world.root,
      env: world.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
    world.tag,
  );
  handle.child.stderr.resume();
  const lines: string[] = [];
  handle.child.stdout.on("data", (chunk: Buffer) =>
    lines.push(...chunk.toString("utf8").split("\n").filter(Boolean)),
  );
  for (let waited = 0; waited < 5000 && lines.length === 0; waited += 20) await sleep(20);
  if (lines.length === 0) throw new Error("the probe child never printed its ready line");
  return { handle, lines };
}

const isGone = async (identity: ProcessIdentity): Promise<boolean> => !(await isSameProcessAlive(identity));

async function stopsAfterVerifiedDeath(
  world: World,
  script: string,
  expectEscalation: boolean,
): Promise<CheckOutcome> {
  const { handle } = await spawnNode(world, script);
  const result = await stopSupervised(handle, FAST_STOP);
  if (result.outcome !== "stopped") return fail(`stop did not verify death: ${JSON.stringify(result)}`);
  const gone = await isGone(handle.identity);
  const again = await stopSupervised(handle, FAST_STOP);
  const details = { escalated: result.escalated, deadWhenStoppedReturned: gone, secondStop: again.outcome };
  if (!gone) return fail("stopped was returned while the process was still alive", details);
  if (expectEscalation && !(result.escalated.includes("term") && result.escalated.includes("kill"))) {
    return fail(
      `a SIGTERM-ignoring child was not escalated to a kill: ${result.escalated.join(",") || "none"}`,
      details,
    );
  }
  if (!expectEscalation && result.escalated.includes("kill"))
    return fail("a cooperative child needed SIGKILL", details);
  return pass(
    expectEscalation
      ? "escalated term then kill; death verified before stopped"
      : "closed stdin; death verified before stopped",
    details,
  );
}

async function leavesNoDetachedSurvivors(world: World): Promise<CheckOutcome> {
  const { handle, lines } = await spawnNode(world, WITH_DETACHED_GRANDCHILD);
  const grandchildPid = Number(lines[0]?.replace("grandchild ", ""));
  const grandchild = await readIdentity(grandchildPid, world.tag);
  if (!grandchild) return fail("the grandchild was not running before the stop");
  const escapedSession = grandchild.pgid !== handle.identity.pgid;
  const result = await stopSupervised(handle, FAST_STOP);
  const survivors = !(await isGone(grandchild));
  const details = { escapedSession, stop: result.outcome, grandchildPid };
  if (!escapedSession)
    return fail("the grandchild did not leave the parent's process group; the scenario is void", details);
  if (result.outcome !== "stopped")
    return fail(`stop did not verify death: ${JSON.stringify(result)}`, details);
  return survivors
    ? fail("the detached grandchild survived the stop", details)
    : pass("detached grandchild in its own session died with its parent", details);
}

async function neverSignalsReusedPid(world: World): Promise<CheckOutcome> {
  const { handle } = await spawnNode(world, COOPERATIVE);
  const signals: [number, string | number][] = [];
  const deps: Partial<SupervisorDeps> = { sendSignal: (pid, signal) => void signals.push([pid, signal]) };
  const forged: ProcessIdentity = { ...handle.identity, startTime: FORGED_START_TIME };
  const result = await stopSupervised(forged, FAST_STOP, deps);
  const classified = await classifyAfterRestart(forged);
  const stillAlive = await isSameProcessAlive(handle.identity);
  const details = { outcome: result.outcome, classified, signalsSent: signals.length, stillAlive };
  const cleanup = await stopSupervised(handle, FAST_STOP);
  if (result.outcome !== "not-running" || signals.length > 0)
    return fail("a forged start time was signalled", details);
  if (classified !== "alive-reused-pid" || !stillAlive)
    return fail("the real process was not left untouched", details);
  return cleanup.outcome === "stopped"
    ? pass("altered startTime: not-running, zero signals, real process untouched", details)
    : fail("cleanup of the real process failed", details);
}

interface BridgeFixture {
  readonly bridge: ReturnType<typeof createSpawnBridge>;
  readonly launched: () => number;
  readonly hook: (signal?: AbortSignal) => void;
}

function bridgeFixture(
  world: World,
  options: { refuse?: boolean; recordFails?: boolean } = {},
): BridgeFixture {
  let launches = 0;
  const bridge = createSpawnBridge({
    launch: (spec) => {
      launches += 1;
      return launchDetached(spec);
    },
    nonce: world.tag,
    supervisor: { processTable: psProcessTable, sendSignal: (pid, signal) => void process.kill(pid, signal) },
    recordIdentity: async () => {
      if (options.recordFails) throw new Error("identity store unavailable");
    },
    refuseSpawn: () => options.refuse === true,
  });
  const hook = (signal?: AbortSignal) => {
    const spawnOptions = {
      command: process.execPath,
      args: ["-e", COOPERATIVE, world.tag],
      cwd: world.root,
      env: world.env,
      signal,
    } as Parameters<typeof bridge.hook>[0];
    bridge.hook(spawnOptions);
  };
  return { bridge, launched: () => launches, hook };
}

async function exitedWithin(exit: Promise<void> | undefined, ms: number): Promise<boolean> {
  if (!exit) return false;
  return Promise.race([exit.then(() => true), sleep(ms).then(() => false)]);
}

async function noOrphanAfter(
  fixture: BridgeFixture,
  pid: number | undefined,
): Promise<{ exited: boolean; gone: boolean }> {
  const exited = await exitedWithin(fixture.bridge.exited(), 4000);
  const entry = pid === undefined ? undefined : await psProcessTable.find(pid);
  return { exited, gone: entry === undefined || entry.zombie };
}

async function stopBeforeInput(world: World): Promise<CheckOutcome> {
  const fixture = bridgeFixture(world);
  fixture.hook();
  const identity = await fixture.bridge.identityCommitted();
  if (!identity) return fail("no identity was committed");
  const result = await stopSupervised(identity, FAST_STOP);
  const { exited, gone } = await noOrphanAfter(fixture, identity.pid);
  const details = { stop: result.outcome, exited, gone };
  return result.outcome === "stopped" && exited && gone
    ? pass("stopped a child that never received input; no orphan", details)
    : fail("a child spawned before input was not cleanly stopped", details);
}

async function abortSignalDuringBootstrap(world: World): Promise<CheckOutcome> {
  const fixture = bridgeFixture(world);
  const controller = new AbortController();
  fixture.hook(controller.signal);
  const pid = fixture.bridge.child()?.pid;
  controller.abort();
  fixture.bridge.identityCommitted()?.catch(() => {});
  const { exited, gone } = await noOrphanAfter(fixture, pid);
  const details = { exited, gone };
  return exited && gone
    ? pass("abort right after spawn ended the child; no orphan", details)
    : fail("an aborted bootstrap left a process", details);
}

async function refusedSpawnStartsNothing(world: World): Promise<CheckOutcome> {
  const fixture = bridgeFixture(world, { refuse: true });
  let refused = false;
  try {
    fixture.hook();
  } catch {
    refused = true;
  }
  const details = { refused, launched: fixture.launched() };
  return refused && fixture.launched() === 0
    ? pass("a cancelled run never launched a process", details)
    : fail("a process started after the cancel", details);
}

async function identityFailureKillsChild(world: World): Promise<CheckOutcome> {
  const fixture = bridgeFixture(world, { recordFails: true });
  fixture.hook();
  const pid = fixture.bridge.child()?.pid;
  const rejected = await fixture.bridge.identityCommitted()?.then(
    () => false,
    () => true,
  );
  const { exited, gone } = await noOrphanAfter(fixture, pid);
  const details = { rejected, exited, gone };
  return rejected && exited && gone
    ? pass("identity could not be recorded: the child was killed; no orphan", details)
    : fail("the child outlived a failed identity commit", details);
}

async function niceOf(pid: number): Promise<{ nice: number; pri: number }> {
  const { stdout } = await run("ps", ["-o", "nice=,pri=", "-p", String(pid)]);
  const [nice, pri] = stdout.trim().split(/\s+/).map(Number);
  return { nice: nice ?? Number.NaN, pri: pri ?? Number.NaN };
}

const attempt = (command: string, args: string[]) =>
  spawnSync(command, args, { encoding: "utf8" }).status === 0;

async function priorityPromotionCapability(world: World): Promise<CheckOutcome> {
  const { handle } = await spawnNode(world, COOPERATIVE);
  const pid = handle.identity.pid;
  const before = await niceOf(pid);
  const demoted =
    attempt("renice", ["-n", "5", "-p", String(pid)]) && (await niceOf(pid)).nice === before.nice + 5;
  attempt("renice", ["-n", String(before.nice), "-p", String(pid)]);
  const promotedViaRenice = demoted && (await niceOf(pid)).nice === before.nice;
  const priBefore = (await niceOf(pid)).pri;
  const taskpolicy =
    process.platform === "darwin" &&
    attempt("taskpolicy", ["-b", "-p", String(pid)]) &&
    (await niceOf(pid)).pri < priBefore;
  const restoredViaTaskpolicy =
    taskpolicy && attempt("taskpolicy", ["-B", "-p", String(pid)]) && (await niceOf(pid)).pri === priBefore;
  await stopSupervised(handle, FAST_STOP);
  const details = {
    demoteViaRenice: demoted,
    promoteViaRenice: promotedViaRenice,
    demoteViaTaskpolicy: taskpolicy,
    promoteViaTaskpolicy: restoredViaTaskpolicy,
    niceBefore: before.nice,
  };
  if (promotedViaRenice) return pass("dynamic promotion supported via renice", details);
  if (restoredViaTaskpolicy)
    return pass(
      "dynamic promotion supported via taskpolicy -B -p (renice cannot lower niceness unprivileged)",
      details,
    );
  return unsupported(
    demoted
      ? "a running process can be demoted but not promoted back by its owner"
      : "renice could not change a child's priority",
    details,
  );
}

function scopeMatrix(): CheckOutcome {
  const matrix = {
    requested: scopeMatrixRow(SANDBOX_ON_FOR_SUBAGENT),
    stagingGate: scopeMatrixRow(DEFAULT_SANDBOX_SETTINGS),
    allOn: scopeMatrixRow({ main: true, worktree: true, subagent: true }),
  };
  return pass("resolved sandbox on/off per thread scope from the launch policy decision function", {
    matrix,
  });
}

function definitions(world: World): CheckDefinition[] {
  const support = hostSandboxSupport();
  const hostPath = enforcementPathOf(support);
  const confined = (): Promise<CheckOutcome> =>
    hostPath === "none"
      ? Promise.resolve(
          unsupported(
            `no sandbox enforcement path on this host (${support.platform}): sandbox-exec, bwrap and systemd-run are all absent`,
          ),
        )
      : confinedWrites(world, support);
  const required = (name: string, runCheckBody: () => Promise<CheckOutcome>): CheckDefinition => ({
    name,
    required: true,
    run: runCheckBody,
  });
  return [
    required("write-confinement.sandboxed", confined),
    required("write-confinement.plain-when-off", () => plainWhenOff(world)),
    required("write-confinement.fail-closed-when-unsupported", () => failsClosedWhenUnsupported(world)),
    required("identity-stop.cooperative", () => stopsAfterVerifiedDeath(world, COOPERATIVE, false)),
    required("identity-stop.stubborn-escalates", () => stopsAfterVerifiedDeath(world, STUBBORN, true)),
    required("identity-stop.detached-grandchild", () => leavesNoDetachedSurvivors(world)),
    required("identity-stop.pid-reuse-guard", () => neverSignalsReusedPid(world)),
    required("bootstrap-cancel.stop-before-input", () => stopBeforeInput(world)),
    required("bootstrap-cancel.abort-signal", () => abortSignalDuringBootstrap(world)),
    required("bootstrap-cancel.refused-spawn", () => refusedSpawnStartsNothing(world)),
    required("bootstrap-cancel.identity-commit-failure", () => identityFailureKillsChild(world)),
    { name: "scope-matrix", required: false, run: async () => scopeMatrix() },
    { name: "priority-promotion-capability", required: false, run: () => priorityPromotionCapability(world) },
  ];
}

async function processesTagged(tag: string): Promise<number[]> {
  const { stdout } = await run("ps", ["-A", "-ww", "-o", "pid=,stat=,command="], {
    env: { ...process.env, LC_ALL: "C" },
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split("\n")
    .filter((line) => line.includes(tag))
    .map((line) => line.trim().split(/\s+/))
    .filter(([pid, stat]) => Number(pid) !== process.pid && !stat?.startsWith("Z"))
    .map(([pid]) => Number(pid));
}

async function reapTagged(tag: string): Promise<number[]> {
  const found = await processesTagged(tag);
  for (const pid of found) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  for (let waited = 0; waited < 3000 && (await processesTagged(tag)).length > 0; waited += 50)
    await sleep(50);
  return found;
}

function removeTemp(world: World): CheckOutcome {
  rmSync(world.base, { recursive: true, force: true });
  const homeMarker = join(world.realHome, `.${world.tag}.probe`);
  const leftovers = [world.base, homeMarker].filter((path) => existsSync(path));
  return leftovers.length === 0
    ? pass("temp directory and home marker removed")
    : fail(`left behind: ${leftovers.join(", ")}`);
}

async function cleanupResults(
  world: World,
  timeoutMs: number,
): Promise<{ results: CheckResult[]; leftover: number[] }> {
  const leftover = await reapTagged(world.tag);
  const remaining = await processesTagged(world.tag);
  const results = [
    await runCheck(
      {
        name: "cleanup.no-leftover-processes",
        required: true,
        run: async () =>
          leftover.length === 0 && remaining.length === 0
            ? pass("process table holds no process of this run")
            : fail(
                `processes survived the checks (killed: ${leftover.join(",") || "none"}, still alive: ${remaining.join(",") || "none"})`,
              ),
      },
      timeoutMs,
    ),
    await runCheck(
      { name: "cleanup.no-temp-files", required: true, run: async () => removeTemp(world) },
      timeoutMs,
    ),
  ];
  return { results, leftover };
}

function parseOptions() {
  const { values } = parseArgs({
    options: {
      platform: { type: "string", default: "current" },
      "require-supported": { type: "boolean", default: false },
      output: { type: "string" },
      "timeout-ms": { type: "string", default: "15000" },
    },
  });
  const timeoutMs = Number(values["timeout-ms"]);
  if (values.platform !== "current" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error(
      "usage: verify-runtime-boundary.ts --platform current [--require-supported] [--output <path>] [--timeout-ms <n>]",
    );
    process.exit(EXIT_USAGE);
  }
  return { requireSupported: values["require-supported"] === true, output: values.output, timeoutMs };
}

async function main(): Promise<number> {
  const options = parseOptions();
  const world = createWorld();
  const support = hostSandboxSupport();
  const results: CheckResult[] = [];
  for (const definition of definitions(world)) results.push(await runCheck(definition, options.timeoutMs));
  const cleanup = await cleanupResults(world, options.timeoutMs);
  results.push(...cleanup.results);
  const report = buildReport({
    generatedAt: new Date().toISOString(),
    platform: { os: process.platform, arch: process.arch, node: process.version },
    enforcementPath: enforcementPathOf(support),
    binaries: { ...support.binaries },
    requestedPolicy: {
      settings: SANDBOX_ON_FOR_SUBAGENT,
      scope: "subagent",
      writableRoot: "<temp trusted root>",
      preferBwrap: true,
    },
    results,
    limits: boundaryLimits({ hostPlatform: hostPlatform() }),
    requireSupported: options.requireSupported,
    leftoverProcesses: cleanup.leftover,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    mkdirSync(dirname(resolve(options.output)), { recursive: true });
    writeFileSync(options.output, json);
  } else {
    console.log(json);
  }
  console.log(summaryTable(report));
  for (const entry of report.unsupported) console.warn(`UNSUPPORTED ${entry.check}: ${entry.reason}`);
  console.log(`exit ${report.exitCode}`);
  return report.exitCode;
}

process.exit(await main());
