import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { freePort } from "./update-support";

const run = promisify(execFile);
const REPO = fileURLToPath(new URL("..", import.meta.url));
const OS = process.platform === "darwin" ? "darwin" : "linux";
const ARCH = process.arch === "arm64" ? "arm64" : "x64";
const BIG = 256 * 1024 * 1024;

export const INSTALLED_VERSION = "1.0.0";
export const GOOD_VERSION = "1.0.1";
export const BROKEN_VERSION = "1.0.2";

const archiveName = (version: string) => `tau-${version}-${OS}-${ARCH}.tar.gz`;
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** A `tau` that passes `--version` but fails at everything else: the update must roll back from it. */
const BROKEN_TAU = (version: string) => `#!/bin/sh
if [ "$1" = "--version" ]; then echo "tau ${version}"; exit 0; fi
echo "broken release" >&2
exit 1
`;

async function pack(stage: string, version: string, releases: string): Promise<void> {
  const name = `tau-${version}-${OS}-${ARCH}`;
  const dir = join(releases, version);
  mkdirSync(dir, { recursive: true });
  await run("tar", ["-czf", join(dir, archiveName(version)), "-C", stage, name]);
  writeFileSync(
    join(dir, "SHA256SUMS"),
    `${sha256(join(dir, archiveName(version)))}  ${archiveName(version)}\n`,
  );
}

async function compile(version: string, stage: string): Promise<void> {
  await run(
    "mise",
    [
      "exec",
      "--",
      "pnpm",
      "build:binary",
      "--out",
      join(stage, `tau-${version}-${OS}-${ARCH}`),
      "--version",
      version,
    ],
    { cwd: REPO, maxBuffer: BIG },
  );
}

/** Compiles 1.0.0, 1.0.1 and a broken 1.0.2 once per build of the CLI; later specs reuse the folder. */
export async function ensureReleases(): Promise<string> {
  const stamp = Math.floor(statSync(join(REPO, "packages/cli/dist/bin.js")).mtimeMs);
  const releases = join(realpathSync(tmpdir()), `tau-e2e-releases-${stamp}`);
  if (existsSync(join(releases, "done"))) return releases;
  const stage = mkdtempSync(join(realpathSync(tmpdir()), "tau-e2e-stage-"));
  for (const version of [INSTALLED_VERSION, GOOD_VERSION]) {
    await compile(version, stage);
    await pack(stage, version, releases);
  }
  const broken = join(stage, `tau-${BROKEN_VERSION}-${OS}-${ARCH}`);
  cpSync(join(stage, `tau-${GOOD_VERSION}-${OS}-${ARCH}`), broken, { recursive: true });
  writeFileSync(join(broken, "tau"), BROKEN_TAU(BROKEN_VERSION));
  chmodSync(join(broken, "tau"), 0o755);
  await pack(stage, BROKEN_VERSION, releases);
  cpSync(join(REPO, "install.sh"), join(releases, "install.sh"));
  writeFileSync(join(releases, "done"), "");
  rmSync(stage, { recursive: true, force: true });
  return releases;
}

export interface FakeGitHub {
  readonly api: string;
  /** The version `releases/latest` answers with. */
  latest: string;
  close(): Promise<void>;
}

/** A local stand-in for the GitHub releases API and its asset downloads. */
export async function serveReleases(releases: string, latest: string): Promise<FakeGitHub> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const state = { latest };
  const releaseOf = (version: string) => ({
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [archiveName(version), "SHA256SUMS"].map((name) => ({
      name,
      browser_download_url: `${origin}/dl/${version}/${name}`,
    })),
  });
  const server: Server = createServer((request, response) => {
    const url = request.url ?? "";
    const tag = /^\/releases\/tags\/v(.+)$/.exec(url)?.[1];
    const download = /^\/dl\/([^/]+)\/([^/]+)$/.exec(url);
    if (url === "/releases/latest" || tag !== undefined) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(releaseOf(tag ?? state.latest)));
    } else if (download && existsSync(join(releases, download[1] ?? "", download[2] ?? ""))) {
      response.end(readFileSync(join(releases, download[1] ?? "", download[2] ?? "")));
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  return {
    api: origin,
    get latest() {
      return state.latest;
    },
    set latest(version: string) {
      state.latest = version;
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

export interface BinaryServer {
  readonly baseURL: string;
  readonly home: string;
  readonly installDir: string;
  readonly env: NodeJS.ProcessEnv;
  tau(...args: string[]): Promise<string>;
  stop(): Promise<void>;
}

/** `launchctl` and `systemctl` that always fail, so tau falls back to a detached process, never a real unit. */
function stubServiceManagers(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const name of ["launchctl", "systemctl"]) {
    writeFileSync(join(dir, name), "#!/bin/sh\nexit 1\n");
    chmodSync(join(dir, name), 0o755);
  }
}

/** install.sh into a scratch dir, then `tau start --faux` detached on a random port, a scratch home and a fake GitHub. */
export async function startBinaryServer(releases: string, github: FakeGitHub): Promise<BinaryServer> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tau-e2e-binary-")));
  const installDir = join(root, "install");
  const binDir = join(root, "bin");
  const home = join(root, "tau-home");
  const osHome = join(root, "os-home");
  const stubs = join(root, "stubs");
  for (const dir of [home, osHome]) mkdirSync(dir, { recursive: true });
  stubServiceManagers(stubs);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: osHome,
    PATH: `${stubs}:${process.env.PATH ?? ""}`,
    TAU_HOME: home,
    TAU_INSTALL_DIR: installDir,
    TAU_BIN_DIR: binDir,
    TAU_RELEASES_API: github.api,
    TAU_OPEN_BROWSER: "0",
    TAU_FAKE_REMOTE: "1",
    TAU_FAKE_CLAUDE_CLI: "1",
  };
  await run("sh", [join(releases, "install.sh")], {
    env: {
      ...env,
      TAU_RELEASE_BASE: `file://${join(releases, INSTALLED_VERSION)}`,
      TAU_INSTALL_NO_START: "1",
    },
    maxBuffer: BIG,
  });
  const bin = join(installDir, "current", "tau");
  const tau = async (...args: string[]) =>
    (await run(bin, args, { env, maxBuffer: BIG, timeout: 120_000 })).stdout;
  const port = await freePort();
  await tau("start", "--faux", "--no-open", "--port", String(port));
  return {
    baseURL: `http://127.0.0.1:${port}`,
    home,
    installDir,
    env,
    tau,
    stop: async () => {
      await tau("stop").catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** What the detached updater left behind (job file, log, installed versions): printed when an update spec fails. */
export function updateDiagnostics(server: BinaryServer): string {
  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "(missing)");
  return [
    `update.json: ${read(join(server.home, "update.json"))}`,
    `update.log:\n${read(join(server.home, "update.log"))}`,
    `instance: ${read(join(server.home, "instance.json"))}`,
  ].join("\n");
}
