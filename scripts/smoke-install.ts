import { type ChildProcess, execFile, spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const cliDir = join(import.meta.dirname, "..", "packages", "cli");
const step = (message: string) => console.log(`• ${message}`);

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Expected ${message}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
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

async function waitForHealth(origin: string, server: ChildProcess, output: () => string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`tau exited with ${server.exitCode}\n${output()}`);
    const body = await fetch(`${origin}/api/health`).then(
      (r) => r.json() as Promise<{ ok?: boolean }>,
      () => undefined,
    );
    if (body) {
      expect(body.ok === true, `/api/health to return {ok:true}, got ${JSON.stringify(body)}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`tau did not become ready\n${output()}`);
}

async function verifyNeverBundled(installDir: string) {
  const resolveFrom = createRequire(join(installDir, "node_modules", "@pablopunk", "tau", "package.json"));
  for (const name of ["@opentunnel/client", "effect"]) {
    expect(existsSync(resolveFrom.resolve(name)), `${name} to resolve from the installed node_modules`);
  }
  const piEnv = (await import(pathToFileURL(resolveFrom.resolve("@earendil-works/pi-env")).href)) as {
    localDaemon(): string;
  };
  const daemon = piEnv.localDaemon();
  expect(existsSync(daemon), `the pi-env daemon file at ${daemon}`);
  accessSync(daemon, constants.X_OK);
}

const stop = (server: ChildProcess) =>
  new Promise<void>((done) => {
    if (server.exitCode !== null || server.signalCode !== null) return done();
    server.once("exit", () => done());
    server.kill("SIGTERM");
    setTimeout(() => server.kill("SIGKILL"), 5000).unref();
  });

async function main() {
  const root = await mkdtemp(join(tmpdir(), "tau-smoke-"));
  let server: ChildProcess | undefined;
  try {
    const packDir = join(root, "pack");
    const installDir = join(root, "install");
    const home = join(root, "home");
    await Promise.all([mkdir(packDir), mkdir(installDir), mkdir(home)]);
    step("pnpm pack");
    const tarball = await packTarball(packDir);
    step("npm install the tarball into an empty directory");
    await run("npm", ["install", "--prefix", installDir, "--no-audit", "--no-fund", tarball], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const bin = join(installDir, "node_modules", ".bin", "tau");
    const env = { ...process.env, TAU_HOME: home, TAU_FAUX: "1", TAU_NO_UPDATE_CHECK: "1" };

    const { stdout } = await run(bin, ["--version"], { env });
    step(`tau --version: ${stdout.trim()}`);
    expect(/\d+\.\d+\.\d+/.test(stdout), "tau --version to print a version");

    step("neverBundle packages resolve");
    await verifyNeverBundled(installDir);

    const port = await freePort();
    let log = "";
    server = spawn(bin, ["serve", "--faux", "--no-open", "--port", String(port), "--home", home], { env });
    server.stdout?.on("data", (chunk) => (log += chunk));
    server.stderr?.on("data", (chunk) => (log += chunk));
    step(`tau serve on port ${port}`);
    await waitForHealth(`http://127.0.0.1:${port}`, server, () => log);
    step("/api/health ok");
  } finally {
    if (server) await stop(server);
    await rm(root, { recursive: true, force: true });
  }
  console.log("smoke:install passed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
