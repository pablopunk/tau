/**
 * Compile tau for one platform into a version folder: `tau`, `pi-env`, `claude-sdk/`, `web/`, `skills/`, `sherpa-onnx/`.
 * Needs `pnpm build` first (it reads packages/cli/dist) and `bun` on PATH.
 *
 *   tsx scripts/build-binary.ts --out <dir> [--target bun-darwin-arm64] [--version <v>] [--no-sdk]
 *
 * The host platform is the default target. Signing, pruning beyond the target platform and archiving are the release workflow's.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "packages", "cli");

const TARGETS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-x64-baseline", "linux-arm64"] as const;
type Platform = (typeof TARGETS)[number];

function fail(message: string): never {
  throw new Error(message);
}

export function hostPlatform(): Platform {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}` as Platform;
}

/** `bun-linux-x64-baseline` and `linux-x64-baseline` both name the baseline build. */
export function platformOf(target: string): Platform {
  const name = target.replace(/^bun-/, "");
  return (TARGETS as readonly string[]).includes(name)
    ? (name as Platform)
    : fail(`Unsupported target: ${target}`);
}

/** The package that holds the native packages: `os-arch` without the `-baseline` suffix. */
export const nativeSuffixOf = (platform: Platform): string => platform.replace(/-baseline$/, "");

function packageVersion(): string {
  return (JSON.parse(readFileSync(join(cli, "package.json"), "utf8")) as { version: string }).version;
}

function copyPiEnv(platform: Platform, out: string): void {
  const source = join(
    cli,
    "node_modules",
    "@earendil-works",
    "pi-env",
    "bin",
    `pi-env-${nativeSuffixOf(platform)}`,
    "pi-env",
  );
  if (!existsSync(source)) fail(`pi-env for ${platform} not found at ${source}`);
  cpSync(source, join(out, "pi-env"));
}

function copyAssets(out: string): void {
  const web = join(root, "packages", "web", "dist");
  if (!existsSync(join(web, "index.html"))) fail("packages/web/dist is missing: run `pnpm build` first");
  cpSync(web, join(out, "web"), { recursive: true });
  cpSync(join(root, "packages", "core", "src", "skills", "builtin"), join(out, "skills"), {
    recursive: true,
  });
}

const SDK = "@anthropic-ai/claude-agent-sdk";

/** The pure-JS+WASM speech engine the voice worker loads at runtime (never bundled: Emscripten glue only inits from real files). */
function copyVoiceEngine(out: string): void {
  const version = JSON.parse(readFileSync(join(root, "packages", "core", "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const pinned = version.dependencies?.["sherpa-onnx"];
  if (!pinned) fail("packages/core/package.json does not depend on sherpa-onnx");
  const store = join(root, "node_modules", ".pnpm");
  const folder = readdirSync(store).find((name) => name === `sherpa-onnx@${pinned.replace(/^[\^~]/, "")}`);
  if (!folder) fail("sherpa-onnx is not installed: run `pnpm install`");
  copyFollowingLinks(join(store, folder, "node_modules", "sherpa-onnx"), join(out, "sherpa-onnx"));
}

/** The virtual-store folder of the pinned SDK holds the SDK and its dependencies as siblings; `-L` flattens the links. */
function copyClaudeSdk(platform: Platform, out: string): void {
  const store = join(root, "node_modules", ".pnpm");
  const sdkFolder = readdirSync(store).find((name) => name.startsWith("@anthropic-ai+claude-agent-sdk@"));
  if (!sdkFolder) fail("The Claude Agent SDK is not installed: run `pnpm install`");
  const modules = join(out, "claude-sdk", "node_modules");
  mkdirSync(modules, { recursive: true });
  copyFollowingLinks(join(store, sdkFolder, "node_modules"), modules);
  const nativeName = `claude-agent-sdk-${nativeSuffixOf(platform)}`;
  rmForeignNatives(modules, nativeName);
  const target = join(modules, "@anthropic-ai", nativeName);
  if (existsSync(target)) return;
  const nativeFolder = readdirSync(store).find((name) => name.startsWith(`@anthropic-ai+${nativeName}@`));
  if (!nativeFolder)
    fail(
      `The native Claude CLI for ${platform} is not installed (a pnpm install on another platform skips it)`,
    );
  copyFollowingLinks(join(store, nativeFolder, "node_modules", "@anthropic-ai", nativeName), target);
}

/** `cp -RL` (Node's `cpSync` does not follow the symlinks pnpm leaves inside a folder). */
function copyFollowingLinks(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  execFileSync("cp", ["-RL", `${from}/.`, to]);
}

/** Keep one native package: the copied siblings may hold the host's. */
function rmForeignNatives(modules: string, keep: string): void {
  const scope = join(modules, "@anthropic-ai");
  for (const name of existsSync(scope) ? readdirSync(scope) : []) {
    if (name.startsWith("claude-agent-sdk-") && name !== keep)
      rmSync(join(scope, name), { recursive: true, force: true });
  }
}

function compile(platform: Platform, version: string, out: string): void {
  const dist = join(cli, "dist");
  if (!existsSync(join(dist, "bin.js"))) fail("packages/cli/dist is missing: run `pnpm build` first");
  const args = [
    "build",
    "--compile",
    `--target=bun-${platform}`,
    "--define",
    `TAU_VERSION=${JSON.stringify(version)}`,
    join(dist, "bin.js"),
    join(dist, "watchdog.js"),
    join(dist, "transcriber-worker.js"),
    "--outfile",
    join(out, "tau"),
  ];
  retry(() => {
    execFileSync("bun", args, { stdio: "inherit" });
  });
}

/** Bun downloads the target runtime on first use; a flaky network fails the compile once. */
function retry(action: () => void, attempts = 3): void {
  for (let attempt = 1; ; attempt++) {
    try {
      action();
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.warn(`compile failed (attempt ${attempt}/${attempts}), retrying`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000 * attempt);
    }
  }
}

function main(): void {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      target: { type: "string" },
      version: { type: "string" },
      "no-sdk": { type: "boolean", default: false },
    },
  });
  if (!values.out) fail("--out <dir> is required");
  const platform = values.target ? platformOf(values.target) : hostPlatform();
  const out = resolve(values.out);
  const version = values.version ?? packageVersion();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  compile(platform, version, out);
  copyPiEnv(platform, out);
  copyAssets(out);
  copyVoiceEngine(out);
  if (!values["no-sdk"]) copyClaudeSdk(platform, out);
  console.log(`tau ${version} (${platform}) -> ${out}`);
}

main();
