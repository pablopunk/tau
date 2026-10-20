/**
 * Smoke test of the shipped artifact (BUN-BINARY.md section 7): install.sh, then the installed binary.
 *
 *   tsx scripts/smoke-binary.ts                          compile for the host first (needs `pnpm build`)
 *   tsx scripts/smoke-binary.ts --release-dir <dir>      use a release folder (archives, SHA256SUMS, install.sh), as CI does
 *
 * Everything runs in temp dirs (TAU_INSTALL_DIR, TAU_BIN_DIR, TAU_HOME) with TAU_INSTALL_NO_START=1: no service is installed.
 * TAU_SMOKE_SKIP_SDK_IMPORT=1 skips only the "SDK loads in the compiled server" step.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const step = (message: string) => console.log(`• ${message}`);

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Expected ${message}`);
}

const os = process.platform === "darwin" ? "darwin" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  await new Promise((done) => server.close(done));
  return port;
}

const cliVersion = () =>
  (JSON.parse(readFileSync(join(root, "packages", "cli", "package.json"), "utf8")) as { version: string })
    .version;

/** Compile for the host and lay out a release folder: archive, SHA256SUMS, install.sh. */
async function buildLocalRelease(dir: string, version: string): Promise<void> {
  const name = `tau-${version}-${os}-${arch}`;
  step(`compile ${name}`);
  await run("pnpm", ["build:binary", "--out", join(dir, "stage", name), "--version", version], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  await run("tar", ["-czf", join(dir, `${name}.tar.gz`), "-C", join(dir, "stage"), name]);
  await run("sh", ["-c", `shasum -a 256 ${name}.tar.gz > SHA256SUMS`], { cwd: dir });
  await run("cp", [join(root, "install.sh"), join(dir, "install.sh")]);
  await rm(join(dir, "stage"), { recursive: true, force: true });
}

async function install(releaseDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  step("install.sh");
  const { stdout } = await run("sh", [join(releaseDir, "install.sh")], {
    env: { ...env, TAU_RELEASE_BASE: `file://${releaseDir}`, TAU_INSTALL_NO_START: "1" },
  });
  expect(stdout.includes("Installed tau"), `install.sh to report the install, got:\n${stdout}`);
}

async function waitForHealth(origin: string, server: ChildProcess, output: () => string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (server.exitCode !== null) throw new Error(`tau exited with ${server.exitCode}\n${output()}`);
    const body = await fetch(`${origin}/api/health`).then(
      (r) => r.json() as Promise<{ ok?: boolean }>,
      () => undefined,
    );
    if (body) return expect(body.ok === true, `/api/health to return {ok:true}, got ${JSON.stringify(body)}`);
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`tau did not become ready\n${output()}`);
}

const stop = (server: ChildProcess) =>
  new Promise<void>((done) => {
    if (server.exitCode !== null || server.signalCode !== null) return done();
    server.once("exit", () => done());
    server.kill("SIGTERM");
    setTimeout(() => server.kill("SIGKILL"), 5000).unref();
  });

type Driver = { tau(...args: string[]): Promise<string>; origin: string; token: string };

async function json<T>(driver: Driver, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${driver.origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${driver.token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.ok, `${path} to answer 2xx, got ${response.status}`);
  return (await response.json()) as T;
}

async function fauxThread(driver: Driver, project: string): Promise<string> {
  await driver.tau("providers", "set-key", "openrouter", "smoke-key");
  await driver.tau("settings", "set-default-model", "faux/faux-1");
  const added = JSON.parse(await driver.tau("projects", "add", project)) as { id: string };
  const started = await driver.tau(
    "threads",
    "start",
    "hello from the smoke test",
    "--request-id",
    "smoke-1",
    "--project",
    added.id,
    "--wait",
    "--timeout",
    "60",
  );
  expect(started.length > 0, "the faux thread to answer");
  return (JSON.parse(await driver.tau("threads", "list")) as Array<{ id: string }>)[0]?.id ?? "";
}

async function terminalEcho(driver: Driver, threadId: string): Promise<void> {
  expect((await json<{ available: boolean }>(driver, "/api/terminals/available")).available, "terminals");
  const info = await json<{ id: string }>(driver, `/api/conversations/${threadId}/terminals`, {
    cols: 80,
    rows: 24,
  });
  const url = `${driver.origin.replace("http", "ws")}/api/terminals/${info.id}/stream`;
  const Socket = WebSocket as unknown as new (u: string, o: unknown) => WebSocket;
  const socket = new Socket(url, { headers: { authorization: `Bearer ${driver.token}` } });
  socket.binaryType = "arraybuffer";
  await new Promise<void>((done, fail) => {
    let seen = "";
    const timer = setTimeout(() => fail(new Error(`no 42marker from the terminal, saw: ${seen}`)), 30_000);
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        if ((JSON.parse(event.data) as { type: string }).type === "ready")
          socket.send(new TextEncoder().encode("echo $((6*7))marker\r"));
        return;
      }
      seen += new TextDecoder().decode(event.data as ArrayBuffer);
      if (seen.includes("42marker")) {
        clearTimeout(timer);
        socket.close();
        done();
      }
    };
    socket.onerror = () => fail(new Error("terminal websocket error"));
  });
}

async function sdkImport(driver: Driver, installDir: string): Promise<void> {
  const sdk = join(installDir, "current", "claude-sdk", "node_modules", "@anthropic-ai");
  expect(existsSync(join(sdk, "claude-agent-sdk", "sdk.mjs")), "the SDK in claude-sdk/");
  const native = readdirSync(sdk).find((name) => name.startsWith("claude-agent-sdk-"));
  expect(native, "the native Claude CLI package in claude-sdk/");
  const { stdout } = await run(join(sdk, native, "claude"), ["--version"], {
    env: { ...process.env, HOME: join(installDir, "claude-home") },
  });
  step(`native claude: ${stdout.trim()}`);
  if (process.env.TAU_SMOKE_SKIP_SDK_IMPORT === "1") return step("SDK import step skipped");
  const refreshed = await driver.tau("providers", "claude-cli", "refresh");
  expect(!refreshed.includes("sdk_missing"), `the compiled server to load the SDK, got ${refreshed}`);
}

async function smoke(installDir: string, binDir: string, home: string, version: string): Promise<void> {
  const bin = join(installDir, "current", "tau");
  const env = { ...process.env, TAU_HOME: home, TAU_NO_UPDATE_CHECK: "1" };
  expect(existsSync(join(binDir, "tau")), "the tau link in the bin dir");
  const versionOut = (await run(join(binDir, "tau"), ["--version"], { env })).stdout.trim();
  step(`tau --version: ${versionOut}`);
  expect(versionOut.includes(version), `the version to contain ${version}`);

  const port = await freePort();
  let log = "";
  const server = spawn(bin, ["serve", "--faux", "--no-open", "--port", String(port), "--home", home], {
    env: { ...env, TAU_FAUX: "1" },
  });
  server.stdout?.on("data", (chunk) => (log += chunk));
  server.stderr?.on("data", (chunk) => (log += chunk));
  try {
    const origin = `http://127.0.0.1:${port}`;
    await waitForHealth(origin, server, () => log);
    step(`/api/health ok on port ${port}`);
    const driver: Driver = {
      origin,
      token: readFileSync(join(home, "token"), "utf8").trim(),
      tau: async (...args) =>
        (await run(bin, [...args, "--home", home], { env, maxBuffer: 16 * 1024 * 1024 })).stdout,
    };
    const project = join(home, "..", "project");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "README.md"), "smoke\n");
    const threadId = await fauxThread(driver, project);
    step("faux thread ok");
    await terminalEcho(driver, threadId);
    step("terminal echo ok");
    await sdkImport(driver, installDir);
  } catch (error) {
    console.error(`--- server log ---\n${log}`);
    throw error;
  } finally {
    await stop(server);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { "release-dir": { type: "string" }, version: { type: "string" } },
  });
  const scratch = await mkdtemp(join(tmpdir(), "tau-smoke-"));
  try {
    const version = values.version ?? cliVersion();
    let releaseDir = values["release-dir"] ? resolve(values["release-dir"]) : "";
    if (!releaseDir) {
      releaseDir = join(scratch, "release");
      await mkdir(releaseDir);
      await buildLocalRelease(releaseDir, version);
    }
    const installDir = join(scratch, "install");
    const binDir = join(scratch, "bin");
    const home = join(scratch, "data", "home");
    await mkdir(home, { recursive: true });
    const env = { ...process.env, TAU_INSTALL_DIR: installDir, TAU_BIN_DIR: binDir, TAU_HOME: home };
    await install(releaseDir, env);
    await smoke(installDir, binDir, home, version);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  console.log("smoke:binary passed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
