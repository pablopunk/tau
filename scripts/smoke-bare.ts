import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const cliDir = join(import.meta.dirname, "..", "packages", "cli");
const step = (message: string) => console.log(`• ${message}`);

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Expected ${message}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  await new Promise((done) => server.close(done));
  return port;
}

async function packTarball(destination: string): Promise<string> {
  await run("pnpm", ["pack", "--pack-destination", destination], {
    cwd: cliDir,
    maxBuffer: 16 * 1024 * 1024,
  });
  const file = (await readdir(destination)).find((name) => name.endsWith(".tgz"));
  if (!file) throw new Error("pnpm pack produced no tarball");
  return join(destination, file);
}

function assertInside(root: string, label: string, path: string) {
  const rel = relative(root, resolve(path));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} (${path}) is outside the scratch dir ${root}: aborting`);
  }
}

async function writeFakes(bin: string, stateDir: string) {
  const fake = join(import.meta.dirname, "fake-service-manager.mjs");
  await mkdir(bin, { recursive: true });
  for (const tool of ["launchctl", "systemctl", "loginctl"]) {
    const file = join(bin, tool);
    await writeFile(
      file,
      `#!/bin/sh\nFAKE_SM_DIR="${stateDir}" exec "${process.execPath}" "${fake}" ${tool} "$@"\n`,
    );
    await chmod(file, 0o755);
  }
}

type Result = { code: number; output: string };

function bare(env: NodeJS.ProcessEnv, entry: string, args: string[]): Promise<Result> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [entry, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) => done({ code: code ?? 1, output }));
  });
}

async function waitForHealth(origin: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const ok = await fetch(`${origin}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`tau did not answer at ${origin}`);
}

const servicePid = async (stateDir: string) =>
  Number(await readFile(join(stateDir, "service.pid"), "utf8").catch(() => "0"));
const calls = (stateDir: string) => readFile(join(stateDir, "calls.log"), "utf8").catch(() => "");

function killPid(pid: number) {
  try {
    if (pid > 0) process.kill(pid, "SIGTERM");
  } catch {}
}

async function main() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "tau-smoke-bare-")));
  const spawned = new Set<number>();
  try {
    const home = join(root, "home");
    const tauHome = join(root, "tau-home");
    const prefix = join(root, "prefix");
    const stateDir = join(home, ".fake-service-manager");
    const bin = join(root, "bin");
    const npxDir = join(root, "npx", "_npx", "abc123", "node_modules");
    const packDir = join(root, "pack");
    await Promise.all([home, tauHome, prefix, packDir, npxDir].map((dir) => mkdir(dir, { recursive: true })));
    for (const [label, path] of [
      ["HOME", home],
      ["TAU_HOME", tauHome],
      ["npm prefix", prefix],
      ["PATH bin", bin],
    ] as const) {
      assertInside(root, label, path);
    }
    await writeFakes(bin, stateDir);

    step("pnpm pack");
    const tarball = await packTarball(packDir);
    await copyFile(tarball, join(root, "npx", "_npx", "abc123", "tau.tgz"));
    // Start the CLI like npx does: unpacked into an `_npx` cache folder.
    await run("tar", ["-xzf", tarball, "-C", npxDir]);
    const entry = join(npxDir, "package", "dist", "bin.js");
    expect(existsSync(entry), `the packed CLI entry at ${entry}`);

    const port = await freePort();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      TAU_HOME: tauHome,
      npm_config_prefix: prefix,
      TAU_BOOTSTRAP_SPEC: tarball,
      TAU_NO_UPDATE_CHECK: "1",
      TAU_FAUX: "1",
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    };
    delete env.XDG_RUNTIME_DIR;
    if (process.platform === "linux") env.XDG_RUNTIME_DIR = join(root, "runtime");
    if (env.XDG_RUNTIME_DIR) await mkdir(env.XDG_RUNTIME_DIR, { recursive: true });
    assertInside(root, "XDG_RUNTIME_DIR", env.XDG_RUNTIME_DIR ?? root);

    step(`bare tau via npx-like entry on port ${port}`);
    const first = await bare(env, entry, ["--no-open", "--port", String(port), "--home", tauHome]);
    spawned.add(await servicePid(stateDir));
    expect(first.code === 0, `exit 0, got ${first.code}\n${first.output}`);

    step("global install landed in the scratch prefix");
    const globalBin = join(prefix, "bin", "tau");
    expect(existsSync(globalBin), `a global tau at ${globalBin}\n${first.output}`);

    step("fake service manager got the install calls");
    const log = await calls(stateDir);
    expect(/launchctl.*bootstrap|systemctl.*(enable|start)/.test(log), `bootstrap/start calls, got:\n${log}`);

    step("output has Open: with a token URL and the tau pair line, and no QR");
    expect(
      /Open: http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/.test(first.output),
      `an Open: token URL\n${first.output}`,
    );
    expect(first.output.includes("tau pair"), `the tau pair line\n${first.output}`);
    expect(!/[█▀▄]/.test(first.output), `no QR code\n${first.output}`);
    await waitForHealth(`http://127.0.0.1:${port}`);

    step("re-run keeps the same service pid");
    const pidBefore = await servicePid(stateDir);
    const again = await bare(env, entry, ["--no-open", "--port", String(port), "--home", tauHome]);
    expect(again.code === 0, `exit 0 on re-run\n${again.output}`);
    expect(again.output.includes("already running"), `"already running"\n${again.output}`);
    expect((await servicePid(stateDir)) === pidBefore, "the same pid after a re-run");
  } finally {
    for (const pid of spawned) killPid(pid);
    await rm(root, { recursive: true, force: true });
  }
  console.log("smoke:bare passed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
