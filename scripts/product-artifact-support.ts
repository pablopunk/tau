import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { ConversationSummary, ModelInfo, Project } from "../packages/protocol/src/entities";
import type { ArtifactManifest, ScenarioManifest } from "./verify-product-artifact";

const exec = promisify(execFile);
export const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export const isPiConversationSummary = (summary: Pick<ConversationSummary, "executor">): boolean =>
  summary.executor === undefined || summary.executor === "pi";
type Artifact = ArtifactManifest["candidate"];
export class EvidenceBlocked extends Error {}
export type Assertion = { id: string; status: "PASS" | "FAIL" | "BLOCKED"; reason: string };

export function isolatedEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    TAU_HOME: join(home, "state"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
    TMPDIR: join(home, "tmp"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    TAU_CLAUDE_PATH: join(home, "absent-claude"),
  };
}

export async function containedFile(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const full = resolve(base, path);
  if (!full.startsWith(`${base}${sep}`)) throw new EvidenceBlocked("path_escape");
  let part = base;
  for (const segment of relative(base, full).split(sep)) {
    part = join(part, segment);
    if ((await lstat(part)).isSymbolicLink()) throw new EvidenceBlocked("symlink_in_artifact");
  }
  if (!(await lstat(full)).isFile()) throw new EvidenceBlocked("not_regular_file");
  return full;
}

async function filesUnder(root: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new EvidenceBlocked("symlink_in_artifact");
    if (entry.isDirectory()) result.push(...(await filesUnder(root, path)));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

export async function verifyArtifact(item: Artifact): Promise<{ sdkTreeSha256: string }> {
  if (item.platform.os !== process.platform || item.platform.arch !== process.arch)
    throw new EvidenceBlocked("unsupported_platform");
  const declared = [item.binary, item.web.index, ...item.web.js, ...item.web.css];
  for (const file of declared) {
    const path = await containedFile(item.directory, file.path);
    if (digest(await readFile(path)) !== file.sha256) throw new EvidenceBlocked("artifact_checksum_mismatch");
  }
  const bytes = await readFile(join(item.directory, item.binary.path));
  const magic = bytes.subarray(0, 4).toString("hex");
  if (
    !(process.platform === "darwin"
      ? ["cffaedfe", "feedfacf", "cafebabe"].includes(magic)
      : magic === "7f454c46")
  )
    throw new EvidenceBlocked("not_compiled_binary");
  const actualAssets = (await filesUnder(join(item.directory, "web")))
    .filter((path) => /\.(js|css)$/.test(path))
    .map((path) => `web/${path}`);
  const expectedAssets = [...item.web.js, ...item.web.css].map((file) => file.path).sort();
  if (JSON.stringify(actualAssets.sort()) !== JSON.stringify(expectedAssets))
    throw new EvidenceBlocked("incomplete_web_inventory");
  for (const path of ["pi-env", "skills/tau/SKILL.md", "sherpa-onnx/package.json"])
    await containedFile(item.directory, path);
  const sdkRelative = "claude-sdk/node_modules/@anthropic-ai/claude-agent-sdk";
  const sdkRoot = join(item.directory, sdkRelative);
  const pkg = JSON.parse(
    await readFile(await containedFile(item.directory, `${sdkRelative}/package.json`), "utf8"),
  );
  const pinnedRoot = resolve(
    import.meta.dirname,
    "../packages/core/node_modules/@anthropic-ai/claude-agent-sdk",
  );
  const pinned = JSON.parse(await readFile(join(pinnedRoot, "package.json"), "utf8"));
  const corePackage = JSON.parse(
    await readFile(resolve(import.meta.dirname, "../packages/core/package.json"), "utf8"),
  );
  if (corePackage.dependencies?.[item.sdk.name] !== pkg.version)
    throw new EvidenceBlocked("sdk_source_pin_mismatch");
  if (pkg.name !== item.sdk.name || pkg.version !== item.sdk.version || pinned.version !== pkg.version)
    throw new EvidenceBlocked("sdk_pin_mismatch");
  const inventory = createHash("sha256");
  const files = (await filesUnder(sdkRoot)).filter((file) => !file.startsWith("node_modules/"));
  const pinnedFiles = (await filesUnder(await realpath(pinnedRoot))).filter(
    (file) => !file.startsWith("node_modules/"),
  );
  if (JSON.stringify(files) !== JSON.stringify(pinnedFiles))
    throw new EvidenceBlocked("sdk_inventory_mismatch");
  for (const file of files) {
    const sha = digest(await readFile(await containedFile(item.directory, `${sdkRelative}/${file}`)));
    if (sha !== digest(await readFile(join(pinnedRoot, file))))
      throw new EvidenceBlocked("sdk_content_mismatch");
    inventory.update(`${sha}  ${file}\n`);
  }
  const native = `claude-sdk/node_modules/@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  const nativePkg = JSON.parse(
    await readFile(await containedFile(item.directory, `${native}/package.json`), "utf8"),
  );
  if (nativePkg.version !== pkg.version) throw new EvidenceBlocked("native_sdk_pin_mismatch");
  const nativeRoot = join(item.directory, native);
  const pinnedNative = await realpath(
    join(dirname(await realpath(pinnedRoot)), `claude-agent-sdk-${process.platform}-${process.arch}`),
  );
  const nativeFiles = await filesUnder(nativeRoot);
  if (JSON.stringify(nativeFiles) !== JSON.stringify(await filesUnder(pinnedNative)))
    throw new EvidenceBlocked("native_sdk_inventory_mismatch");
  for (const file of nativeFiles) {
    const sha = digest(await readFile(await containedFile(item.directory, `${native}/${file}`)));
    if (sha !== digest(await readFile(join(pinnedNative, file))))
      throw new EvidenceBlocked("native_sdk_content_mismatch");
    inventory.update(`${sha}  native/${file}\n`);
  }
  return { sdkTreeSha256: inventory.digest("hex") };
}

export const FIXTURES = {
  "small-v1": {
    files: 16,
    bytesPerFile: 1024,
    directories: 4,
    inventorySha256: "9d6142eb1f252c4e04c9e0e584ee54fe6adbb0585627f0a27fdd22e9bf7a968c",
  },
  "monorepo-v1": {
    files: 4096,
    bytesPerFile: 4096,
    directories: 64,
    inventorySha256: "b1f31fac0964930d4fdaf1e68edf0399da9cbfdfb5468fc3335c73e0efd4e259",
  },
} as const;

export const LONG_STREAM_TEXT = `E_LONG_STREAM_START:${"0123456789abcdef".repeat(512)}:E_LONG_STREAM_END`;

export async function seedRepository(
  root: string,
  fixtureId: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const spec = FIXTURES[fixtureId as keyof typeof FIXTURES];
  if (!spec) throw new EvidenceBlocked("unsupported_fixture");
  const repo = join(root, `repo-${randomUUID()}`);
  await mkdir(repo);
  const inventory = createHash("sha256");
  for (let i = 0; i < spec.files; i++) {
    const path = `dir-${Math.floor(i / Math.ceil(spec.files / spec.directories))}/file-${i}.txt`;
    const line = `product-recovery/v1 seed=15158 file=${i}\n`;
    const bytes = line.repeat(Math.ceil(spec.bytesPerFile / line.length)).slice(0, spec.bytesPerFile);
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), bytes, { flag: "wx" });
    inventory.update(`${digest(bytes)}  ${path}\n`);
  }
  if (inventory.digest("hex") !== spec.inventorySha256) throw new Error("fixture_inventory_mismatch");
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["add", "-A"],
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-q",
      "-m",
      "synthetic fixture",
    ],
  ])
    await exec("git", args, { cwd: repo, env, timeout: 30_000 });
  return realpath(repo);
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port_allocation_failed");
  await new Promise<void>((yes, no) => server.close((error) => (error ? no(error) : yes())));
  return address.port;
}

export async function processIdentity(pid: number): Promise<string | null> {
  try {
    return (await exec("ps", ["-p", String(pid), "-o", "lstart=", "-o", "command="])).stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function descendantIdentities(pid: number): Promise<Map<number, string>> {
  const { stdout } = await exec("ps", ["-axo", "pid=,ppid="]);
  const rows = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const ids = new Set([pid]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [child, parent] of rows)
      if (child && parent && ids.has(parent) && !ids.has(child)) {
        ids.add(child);
        changed = true;
      }
  }
  const result = new Map<number, string>();
  for (const id of ids) {
    const identity = await processIdentity(id);
    if (identity) result.set(id, identity);
  }
  return result;
}

export async function stopOwned(
  child: ChildProcess,
  identities: Map<number, string>,
  abrupt = false,
): Promise<boolean> {
  if (!child.pid) return true;
  const original = identities.get(child.pid);
  const current =
    original && (await processIdentity(child.pid)) === original
      ? await descendantIdentities(child.pid)
      : new Map<number, string>();
  for (const [pid, identity] of current) if (!identities.has(pid)) identities.set(pid, identity);
  for (const [pid, identity] of [...identities].reverse()) {
    if ((await processIdentity(pid)) !== identity) continue;
    try {
      process.kill(pid, abrupt ? "SIGKILL" : "SIGTERM");
    } catch {
      /* exited */
    }
  }
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if (
      (
        await Promise.all(
          [...identities].map(async ([pid, identity]) => (await processIdentity(pid)) === identity),
        )
      ).every((alive) => !alive)
    )
      return true;
    await new Promise((yes) => setTimeout(yes, 50));
  }
  return false;
}

export async function portOwnedBy(pid: number, base: string): Promise<boolean> {
  try {
    const { stdout } = await exec("lsof", ["-nP", `-iTCP:${new URL(base).port}`, "-sTCP:LISTEN", "-t"]);
    return (
      !!stdout.trim() &&
      stdout
        .trim()
        .split(/\s+/)
        .every((value) => Number(value) === pid)
    );
  } catch {
    return false;
  }
}

export interface OwnedServer {
  child: ChildProcess;
  identities: Map<number, string>;
  base: string;
  token: string;
  home: string;
  root: string;
  binary: string;
  env: NodeJS.ProcessEnv;
  port: number;
  browserCleanupVerified: boolean;
}
export async function launchServer(item: Artifact, existing?: OwnedServer): Promise<OwnedServer> {
  const root = existing?.root ?? (await realpath(await mkdtemp(join(tmpdir(), "tau-E-artifact-"))));
  const home = join(root, "home");
  await mkdir(join(home, "tmp"), { recursive: true });
  const env = isolatedEnv(home);
  const repliesFile = join(root, "faux-replies.json");
  if (!existing)
    await writeFile(
      repliesFile,
      JSON.stringify({
        "product recovery first reply": [
          { tools: [{ name: "bash", arguments: { command: "pwd > .tau-e-cwd" } }] },
          { text: "E_FIRST_ASSISTANT_TEXT" },
        ],
        "product recovery distinct follow-up": [{ text: "E_FOLLOWUP_ASSISTANT_TEXT" }],
        "product recovery long stream": [{ text: LONG_STREAM_TEXT }],
      }),
      { flag: "wx", mode: 0o600 },
    );
  env.TAU_FAUX_REPLIES = repliesFile;
  const binary = await containedFile(item.directory, item.binary.path);
  if (!existing) {
    try {
      const version = await exec(binary, ["--version"], { env, timeout: 15_000 });
      if (version.stdout.trim() !== item.version && version.stdout.trim() !== `tau ${item.version}`)
        throw new EvidenceBlocked("binary_version_mismatch");
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }
  const port = existing?.port ?? (await freePort());
  const child = spawn(
    binary,
    ["serve", "--faux", "--no-open", "--port", String(port), "--home", join(home, "state")],
    { env, cwd: root, stdio: ["ignore", "ignore", "ignore"] },
  );
  let spawnError = false;
  child.on("error", () => {
    spawnError = true;
  });
  const identities = new Map<number, string>();
  const base = `http://127.0.0.1:${port}`;
  const rig = {
    child,
    identities,
    base,
    token: "",
    home,
    root,
    binary,
    env,
    port,
    browserCleanupVerified: true,
  };
  try {
    for (let i = 0; i < 300; i++) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null)
        throw new Error("artifact_server_exit");
      if (child.pid) {
        const identity = await processIdentity(child.pid);
        if (identity) identities.set(child.pid, identity);
      }
      try {
        rig.token = (await readFile(join(home, "state", "token"), "utf8")).trim();
        const res = await fetch(`${base}/api/health`, {
          signal: AbortSignal.timeout(500),
          headers: { Authorization: `Bearer ${rig.token}` },
        });
        if (res.ok && child.pid && identities.has(child.pid)) {
          if (!(await portOwnedBy(child.pid, base))) throw new EvidenceBlocked("artifact_listener_not_owned");
          return rig;
        }
      } catch (error) {
        if (error instanceof EvidenceBlocked) throw error;
      }
      await new Promise((yes) => setTimeout(yes, 100));
    }
    throw new Error("artifact_server_timeout");
  } catch (error) {
    if (await stopOwned(child, identities)) await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function api<T = unknown>(
  rig: OwnedServer,
  path: string,
  body?: unknown,
  method?: string,
  expectedStatus?: number,
): Promise<T> {
  const res = await fetch(`${rig.base}/api${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${rig.token}`, Origin: rig.base, "Content-Type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!res.ok || (expectedStatus !== undefined && res.status !== expectedStatus))
    throw new Error(`http_${res.status}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

export interface BrowserDescriptor {
  version: 1;
  nonce: string;
  parentPid: number;
  parentIdentity: string;
  pid: number;
  identity: string;
  binary: string;
  binarySha256: string;
  base: string;
  token: string;
  output: string;
  web: Artifact["web"];
  threadId: string;
  projectId: string;
  phase: "first" | "reattach" | "long-stream";
}
export async function validateBrowserDescriptor(value: BrowserDescriptor): Promise<void> {
  if (
    value.version !== 1 ||
    !/^[a-f0-9-]{36}$/.test(value.nonce) ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.base) ||
    (await processIdentity(value.pid)) !== value.identity ||
    (await processIdentity(value.parentPid)) !== value.parentIdentity ||
    digest(await readFile(value.binary)) !== value.binarySha256
  )
    throw new EvidenceBlocked("untrusted_browser_descriptor");
  const descendants = await descendantIdentities(value.parentPid);
  if (descendants.get(value.pid) !== value.identity) throw new EvidenceBlocked("server_not_owned_by_driver");
  if (!(await portOwnedBy(value.pid, value.base))) throw new EvidenceBlocked("port_not_owned_by_artifact");
}

export interface BrowserObservation {
  nonce: string;
  phase: "first" | "reattach" | "long-stream";
  threadId: string;
  firstTextVisible: boolean;
  firstTextLength: number;
  firstAssistantCount: number;
  followupAssistantCount: number;
  followupTextLength: number;
  longStreamComplete: boolean;
  longStreamTextLength: number;
  longStreamProgressed: boolean;
  terminal: boolean;
  frontendVerified: boolean;
  assetResponses: number;
}

export async function browserProbe(
  rig: OwnedServer,
  item: Artifact,
  threadId: string,
  projectId: string,
  phase: "first" | "reattach" | "long-stream",
): Promise<BrowserObservation> {
  if (!rig.child.pid) throw new Error("missing_child_identity");
  const nonce = randomUUID();
  const output = join(rig.root, `browser-${nonce}.json`);
  const descriptorPath = join(rig.root, `descriptor-${nonce}.json`);
  const parentIdentity = await processIdentity(process.pid);
  const identity = await processIdentity(rig.child.pid);
  if (!parentIdentity || !identity) throw new EvidenceBlocked("missing_process_identity");
  const descriptor: BrowserDescriptor = {
    version: 1,
    nonce,
    parentPid: process.pid,
    parentIdentity,
    pid: rig.child.pid,
    identity,
    binary: rig.binary,
    binarySha256: item.binary.sha256,
    base: rig.base,
    token: rig.token,
    output,
    web: item.web,
    threadId,
    projectId,
    phase,
  };
  await writeFile(descriptorPath, JSON.stringify(descriptor), { flag: "wx", mode: 0o600 });
  try {
    const task = exec(
      process.execPath,
      [
        resolve(import.meta.dirname, "../e2e/node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        "product-recovery.config.ts",
      ],
      {
        cwd: resolve(import.meta.dirname, "../e2e"),
        env: {
          ...isolatedEnv(rig.home),
          TAU_ARTIFACT_DESCRIPTOR: descriptorPath,
          PLAYWRIGHT_BROWSERS_PATH:
            process.env.PLAYWRIGHT_BROWSERS_PATH ??
            (process.platform === "darwin"
              ? join(homedir(), "Library/Caches/ms-playwright")
              : join(homedir(), ".cache/ms-playwright")),
        },
        timeout: 200_000,
        maxBuffer: 1024 * 1024,
      },
    );
    const ownedBrowser = new Map<number, string>();
    let sampling = Promise.resolve();
    const sample = () => {
      sampling = sampling
        .then(async () => {
          if (!task.child.pid) return;
          const initial = ownedBrowser.get(task.child.pid);
          if (initial && (await processIdentity(task.child.pid)) !== initial) return;
          for (const [pid, identity] of await descendantIdentities(task.child.pid))
            if (!ownedBrowser.has(pid)) ownedBrowser.set(pid, identity);
        })
        .catch(() => {
          rig.browserCleanupVerified = false;
        });
    };
    sample();
    const timer = setInterval(sample, 100);
    try {
      await task;
    } catch (error) {
      const diagnostic = error as { message?: string; stdout?: string; stderr?: string; code?: string };
      const text = `${diagnostic.message ?? ""} ${diagnostic.stdout ?? ""} ${diagnostic.stderr ?? ""}`;
      if (
        diagnostic.code === "ENOENT" ||
        text.includes("Executable doesn't exist") ||
        text.includes("Cannot find module")
      )
        throw new EvidenceBlocked("browser_dependency_unavailable");
      if (text.includes("untrusted_browser_descriptor") || text.includes("port_not_owned_by_artifact"))
        throw new EvidenceBlocked("browser_spawn_identity_unverified");
      throw new Error("browser_assertion_failed");
    } finally {
      clearInterval(timer);
      await sampling;
      const browserClean = await stopOwned(task.child, ownedBrowser);
      rig.browserCleanupVerified = rig.browserCleanupVerified && ownedBrowser.size > 0 && browserClean;
    }
    if (!rig.browserCleanupVerified) throw new EvidenceBlocked("browser_cleanup_unverified");
    const observed = JSON.parse(await readFile(output, "utf8"));
    if (
      observed.nonce !== nonce ||
      observed.phase !== phase ||
      typeof observed.threadId !== "string" ||
      observed.threadId.length === 0
    )
      throw new Error("browser_observation_identity_mismatch");
    const numeric = [
      "firstTextLength",
      "firstAssistantCount",
      "followupAssistantCount",
      "followupTextLength",
      "longStreamTextLength",
      "assetResponses",
    ] as const;
    if (numeric.some((key) => !Number.isSafeInteger(observed[key]) || observed[key] < 0))
      throw new Error("invalid_browser_observation");
    if (
      typeof observed.longStreamComplete !== "boolean" ||
      typeof observed.longStreamProgressed !== "boolean"
    )
      throw new Error("invalid_browser_observation");
    return {
      nonce,
      phase,
      threadId: observed.threadId,
      firstTextVisible: observed.firstTextVisible === true,
      firstTextLength: observed.firstTextLength,
      firstAssistantCount: observed.firstAssistantCount,
      followupAssistantCount: observed.followupAssistantCount,
      followupTextLength: observed.followupTextLength,
      longStreamComplete: observed.longStreamComplete,
      longStreamTextLength: observed.longStreamTextLength,
      longStreamProgressed: observed.longStreamProgressed,
      terminal: observed.terminal === true,
      frontendVerified: observed.frontendVerified === true,
      assetResponses: observed.assetResponses,
    };
  } finally {
    await rm(descriptorPath, { force: true });
  }
}

export function candidateVerdict(assertions: readonly Assertion[]): "PASS" | "FAIL" | "BLOCKED" {
  if (assertions.some((a) => a.status === "FAIL")) return "FAIL";
  if (!assertions.length || assertions.some((a) => a.status === "BLOCKED")) return "BLOCKED";
  return "PASS";
}

export async function awaitAllOwned<T>(tasks: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(tasks);
  const rejected = settled.find((task) => task.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  return settled.flatMap((task) => (task.status === "fulfilled" ? [task.value] : []));
}

const SELECTED_CELLS: Record<
  string,
  { cwd: "root" | "nested"; workspace: "checkout" | "worktree"; concurrency: 1 | 4; rounds: number }
> = {
  "E.journey": { cwd: "nested", workspace: "worktree", concurrency: 1, rounds: 1 },
  "E.checkout-root": { cwd: "root", workspace: "checkout", concurrency: 1, rounds: 1 },
  "E.monorepo-four": { cwd: "nested", workspace: "worktree", concurrency: 4, rounds: 1 },
  "E.warm": { cwd: "nested", workspace: "worktree", concurrency: 1, rounds: 2 },
  "E.long-stream": { cwd: "root", workspace: "worktree", concurrency: 1, rounds: 1 },
};

async function journey(
  rig: OwnedServer,
  item: Artifact,
  repo: string,
  project: Project,
  model: ModelInfo,
  cell: (typeof SELECTED_CELLS)[string],
  tag: string,
): Promise<{ facts: Record<string, boolean>; observation: unknown }> {
  const submit = performance.now();
  const thread = await api<ConversationSummary>(
    rig,
    "/conversations",
    {
      projectId: project.id,
      text: "product recovery first reply",
      requestId: `E-first-${tag}`,
      workspace: cell.workspace,
      ...(cell.cwd === "nested" && { model: { provider: model.provider, modelId: model.modelId } }),
    },
    "POST",
    201,
  );
  const admittedMs = performance.now() - submit;
  if (!thread.id) throw new Error("missing_thread_identity");
  const first = await browserProbe(rig, item, thread.id, project.id, "first");
  const persisted = (await api<ConversationSummary[]>(rig, "/conversations")).find((t) => t.id === thread.id);
  if (!persisted?.workspace.path) throw new Error("missing_workspace_identity");
  const path = persisted.workspace.path;
  const actual = (
    await exec("git", ["rev-parse", "--show-toplevel"], { cwd: path, env: rig.env })
  ).stdout.trim();
  const payload = cell.cwd === "nested" ? "file-0.txt" : "dir-0/file-0.txt";
  const bytes = await readFile(join(path, payload));
  const expectedLine = "product-recovery/v1 seed=15158 file=0\n";
  const runtimeCwd = await readFile(join(path, ".tau-e-cwd"), "utf8").catch(() => "");
  const runtimeCwdMatches =
    runtimeCwd.trim() !== "" &&
    (await realpath(runtimeCwd.trim())
      .then(async (actualCwd) => actualCwd === (await realpath(path)))
      .catch(() => false));
  const facts: Record<string, boolean> = {
    "E.first-assistant-text": first.firstTextVisible === true && first.firstTextLength > 0,
    "E.follow-up":
      first.followupAssistantCount > first.firstAssistantCount &&
      first.followupTextLength > 0 &&
      first.terminal === true,
    "E.frontend-provenance": first.frontendVerified === true,
    "E.worktree":
      persisted.workspace.mode === cell.workspace &&
      (cell.workspace === "worktree" ? actual !== repo : actual === repo),
    "E.nested-cwd": resolve(path) === resolve(actual, cell.cwd === "nested" ? "dir-0" : "."),
    "E.real-preparation":
      bytes.toString().startsWith(expectedLine) &&
      runtimeCwdMatches &&
      isPiConversationSummary(persisted) &&
      persisted.model?.provider === model.provider &&
      persisted.model?.modelId === model.modelId,
  };
  return {
    facts,
    observation: {
      threadId: thread.id,
      fixturePayloadBytes: bytes.length,
      modelSelection: cell.cwd === "root" ? "default" : "explicit",
      model: { provider: model.provider, modelId: model.modelId },
      cell,
      clockDomain: "driver-monotonic",
      durationsMs: { submitToAdmission: admittedMs },
      browser: first,
    },
  };
}

async function longStreamJourney(
  rig: OwnedServer,
  item: Artifact,
  project: Project,
  model: ModelInfo,
  cell: (typeof SELECTED_CELLS)[string],
): Promise<{ facts: Record<string, boolean>; observation: unknown }> {
  const browser = await browserProbe(rig, item, "", project.id, "long-stream");
  const persisted = (await api<ConversationSummary[]>(rig, "/conversations")).find(
    (thread) => thread.id === browser.threadId,
  );
  const facts: Record<string, boolean> = {
    "E.long-stream":
      browser.firstTextVisible &&
      browser.longStreamProgressed &&
      browser.longStreamComplete &&
      browser.longStreamTextLength === LONG_STREAM_TEXT.length &&
      browser.terminal &&
      browser.frontendVerified &&
      persisted !== undefined &&
      isPiConversationSummary(persisted) &&
      persisted.workspace.mode === cell.workspace &&
      persisted.model?.provider === model.provider &&
      persisted.model?.modelId === model.modelId,
  };
  return {
    facts,
    observation: {
      threadId: browser.threadId,
      fixtureId: "small-v1",
      selectedCell: cell,
      model: { provider: model.provider, modelId: model.modelId },
      expectedTextLength: LONG_STREAM_TEXT.length,
      browser,
    },
  };
}

export async function executeArtifact(
  item: Artifact,
  scenarios: ScenarioManifest,
): Promise<{
  assertions: Assertion[];
  provenanceVerified: boolean;
  sdkTreeSha256: string | null;
  cases: unknown[];
  cleanup: { verified: boolean };
}> {
  const requested = scenarios.cases.flatMap((entry) => entry.requiredAssertions);
  const observations = new Map<string, Assertion>();
  let provenanceVerified = false;
  let sdkTreeSha256: string | null = null;
  let allCleanup = true;
  let launched = 0;
  const cases: unknown[] = [];
  let blockedReason = "unsupported_or_unimplemented_selected_case";
  try {
    ({ sdkTreeSha256 } = await verifyArtifact(item));
    provenanceVerified = true;
  } catch (error) {
    blockedReason = error instanceof EvidenceBlocked ? error.message : "artifact_file_missing_or_unreadable";
  }
  if (provenanceVerified)
    for (const entry of scenarios.cases) {
      const cell = SELECTED_CELLS[entry.id];
      if (!cell) continue;
      let rig: OwnedServer | undefined;
      let failureStage = "launch";
      let reason = "actual_compiled_journey";
      let status: Assertion["status"] = "PASS";
      const facts: Record<string, boolean> = {};
      const samples: unknown[] = [];
      try {
        rig = await launchServer(item);
        launched++;
        const active = rig;
        failureStage = "fixture";
        const repo = await seedRepository(rig.root, entry.fixtureId, rig.env);
        failureStage = "provider-and-model";
        await api(rig, "/providers/openrouter/key", { key: "sk-E-faux-not-a-credential" }, "PUT");
        const model = (await api<ModelInfo[]>(rig, "/models")).find(
          (m) => m.provider === "faux" && m.modelId === "faux-1",
        );
        if (!model) throw new Error("missing_faux_model");
        await api(
          rig,
          "/settings/default-model",
          { provider: model.provider, modelId: model.modelId },
          "PUT",
        );
        failureStage = "projects";
        const projects = await awaitAllOwned(
          Array.from({ length: cell.concurrency }, async (_, lane) => {
            const laneRepo =
              lane === 0 ? repo : await seedRepository(active.root, entry.fixtureId, active.env);
            const project = await api<Project>(active, "/projects", {
              path: cell.cwd === "nested" ? join(laneRepo, "dir-0") : laneRepo,
            });
            return { repo: laneRepo, project };
          }),
        );
        failureStage = "admission-browser-and-workspace";
        for (let round = 0; round < cell.rounds; round++) {
          // Submissions are concurrent; independent browser contexts are owned by the same descriptor-bound driver.
          const results = await awaitAllOwned(
            projects.map(({ repo, project }, lane) => {
              const tag = `${entry.id}-${round}-${lane}`;
              if (entry.id === "E.long-stream") return longStreamJourney(active, item, project, model, cell);
              return journey(active, item, repo, project, model, cell, tag);
            }),
          );
          for (const result of results) {
            samples.push(result.observation);
            for (const [id, pass] of Object.entries(result.facts)) facts[id] = (facts[id] ?? true) && pass;
          }
        }
        const journeyAssertionsFailed = Object.values(facts).some((pass) => !pass);
        if (entry.id === "E.journey") {
          failureStage = "restart";
          const before = await api<ConversationSummary[]>(rig, "/conversations");
          const ownThreads = before.filter((thread) =>
            projects.some(({ project }) => thread.projectId === project.id),
          );
          const old = rig;
          if (!(await stopOwned(old.child, old.identities, true)))
            throw new Error("restart_cleanup_unverified");
          rig = await launchServer(item, old);
          const after = await api<ConversationSummary[]>(rig, "/conversations");
          facts["E.restart"] = ownThreads.length > 0;
          for (const thread of ownThreads) {
            const restored = after.find((candidate) => candidate.id === thread.id);
            const attached = await browserProbe(rig, item, thread.id, thread.projectId, "reattach");
            facts["E.restart"] &&=
              restored !== undefined &&
              restored.executor === thread.executor &&
              restored.projectId === thread.projectId &&
              attached.firstAssistantCount >= 2 &&
              attached.firstTextVisible === true;
          }
          if (facts["E.restart"] !== false && journeyAssertionsFailed) failureStage = "journey-assertions";
        }
        if (Object.values(facts).some((pass) => !pass)) status = "FAIL";
      } catch (error) {
        status = error instanceof EvidenceBlocked ? "BLOCKED" : "FAIL";
        reason = error instanceof EvidenceBlocked ? error.message : "artifact_assertion_or_execution_failed";
      } finally {
        if (rig) {
          const backendClean = await stopOwned(rig.child, rig.identities);
          const clean = backendClean && rig.browserCleanupVerified;
          allCleanup &&= clean;
          if (clean) await rm(rig.root, { recursive: true, force: true });
          facts["E.cleanup"] = clean;
          if (!clean) {
            status = "FAIL";
            reason = "owned_cleanup_unverified";
            for (const id of entry.requiredAssertions) if (id in facts) facts[id] = false;
          }
        }
      }
      cases.push({
        id: entry.id,
        fixtureId: entry.fixtureId,
        selectedCell: cell,
        samples,
        sampleCount: samples.length,
        status,
        reason,
        failureStage: status === "PASS" ? null : failureStage,
      });
      for (const id of entry.requiredAssertions)
        observations.set(id, {
          id,
          status: id in facts ? (facts[id] ? "PASS" : "FAIL") : status,
          reason,
        });
    }
  return {
    assertions: requested.map(
      (id) =>
        observations.get(id) ?? {
          id,
          status: "BLOCKED",
          reason:
            id === "E.native-actual-sdk"
              ? "requires_B_actual_native_driver_and_disposable_guest"
              : blockedReason,
        },
    ),
    provenanceVerified,
    sdkTreeSha256,
    cases,
    cleanup: { verified: launched > 0 && allCleanup },
  };
}
