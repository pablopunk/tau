import { execFile, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { serverEnvironment } from "./support";

const run = promisify(execFile);
const CLI_PACKAGE = fileURLToPath(new URL("../packages/cli/", import.meta.url));

/** The fake updater child: walks the job file like the real one, then restarts the server as `target`. */
const FAKE_UPDATE = `
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const target = process.argv[process.argv.indexOf("--target") + 1];
const file = process.env.TAU_HOME + "/update.json";
const step = (state) => {
  const job = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...job, state, pid: process.pid }));
  console.log("step " + state);
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
step("installing");
await wait(1500);
step("restarting");
await wait(500);
const env = { ...process.env, TAU_FAKE_VERSION: target };
const cli = [process.env.TAU_E2E_CLI];
execFileSync("node", [...cli, "stop"], { env });
execFileSync("node", [...cli, "start", "--faux", "--no-open", "--port", process.env.TAU_E2E_PORT], { env });
`;

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

export interface UpdateServer {
  readonly baseURL: string;
  readonly home: string;
  stop(): Promise<void>;
}

/**
 * A faux detached server on a scratch home under os.tmpdir() and a random port, running a COPY of the built CLI
 * placed where `layout` says (an npm global layout: updatable; an `_npx` cache: manual). Never a real service.
 */
export async function startUpdateServer(layout: "npm-global" | "npx"): Promise<UpdateServer> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tau-e2e-update-")));
  const packageDir =
    layout === "npm-global"
      ? join(root, "lib", "node_modules", "@pablopunk", "tau")
      : join(root, "_npx", "abc", "node_modules", "@pablopunk", "tau");
  mkdirSync(packageDir, { recursive: true });
  cpSync(join(CLI_PACKAGE, "dist"), join(packageDir, "dist"), { recursive: true });
  cpSync(join(CLI_PACKAGE, "package.json"), join(packageDir, "package.json"));
  symlinkSync(join(CLI_PACKAGE, "node_modules"), join(packageDir, "node_modules"));
  const home = join(root, "tau-home");
  const osHome = join(root, "os-home");
  mkdirSync(home);
  mkdirSync(osHome);
  const script = join(root, "fake-update.mjs");
  writeFileSync(script, FAKE_UPDATE);
  const port = await freePort();
  const cli = join(packageDir, "dist", "bin.js");
  const env = {
    ...process.env,
    ...serverEnvironment(),
    HOME: osHome,
    TAU_HOME: home,
    TAU_FAKE_LATEST: "9.9.9",
    TAU_FAKE_UPDATE: script,
    TAU_E2E_CLI: cli,
    TAU_E2E_PORT: String(port),
  };
  const baseURL = `http://127.0.0.1:${port}`;
  if (layout === "npx") return startForeground(cli, port, home, env, baseURL);
  await run("node", [cli, "start", "--faux", "--no-open", "--port", String(port)], { env, timeout: 60_000 });
  return {
    baseURL,
    home,
    stop: async () => {
      await run("node", [cli, "stop"], { env, timeout: 60_000 }).catch(() => undefined);
    },
  };
}

/** `tau start` refuses a temporary npx entry, so that layout runs `tau serve` as a child of the test. */
async function startForeground(
  cli: string,
  port: number,
  home: string,
  env: NodeJS.ProcessEnv,
  baseURL: string,
): Promise<UpdateServer> {
  const child = spawn("node", [cli, "serve", "--faux", "--no-open", "--port", String(port)], {
    env,
    stdio: "ignore",
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const up = await fetch(`${baseURL}/api/update`).then(
      () => true,
      () => false,
    );
    if (up) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  return { baseURL, home, stop: async () => void child.kill("SIGTERM") };
}
