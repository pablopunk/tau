import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseArtifactManifest } from "./verify-product-artifact";

const exec = promisify(execFile);
type Platform = "darwin" | "linux";
type Arch = "arm64" | "x64";

function parseArgs(argv: readonly string[]) {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (
      !key ||
      !["--baseline", "--candidate", "--os", "--arch", "--output"].includes(key) ||
      !value ||
      value.startsWith("--") ||
      values.has(key)
    )
      throw new Error("invalid_invocation");
    values.set(key, value);
  }
  const baseline = values.get("--baseline");
  const candidate = values.get("--candidate");
  const os = values.get("--os");
  const arch = values.get("--arch");
  const output = values.get("--output");
  if (
    !baseline ||
    !candidate ||
    !output ||
    !isAbsolute(baseline) ||
    !isAbsolute(candidate) ||
    !isAbsolute(output)
  )
    throw new Error("invalid_invocation");
  if ((os !== "darwin" && os !== "linux") || (arch !== "arm64" && arch !== "x64"))
    throw new Error("invalid_platform");
  return { baseline, candidate, os, arch, output } as {
    baseline: string;
    candidate: string;
    os: Platform;
    arch: Arch;
    output: string;
  };
}

async function digest(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("artifact_symlink_forbidden");
      if (entry.isDirectory()) return filesIn(path);
      if (!(await lstat(path)).isFile()) throw new Error("artifact_non_file_forbidden");
      return [path];
    }),
  );
  return paths.flat().sort();
}

async function describe(directory: string, os: Platform, arch: Arch) {
  const root = resolve(directory);
  const binaryPath = join(root, "tau");
  const versionOutput = (await exec(binaryPath, ["--version"], { timeout: 15_000 })).stdout.trim();
  const version = versionOutput.startsWith("tau ") ? versionOutput.slice(4) : versionOutput;

  const webRoot = join(root, "web");
  const indexPath = join(webRoot, "index.html");
  const assets = await filesIn(join(webRoot, "assets"));
  const js = assets
    .filter((path) => path.endsWith(".js"))
    .map((path) => ({ path: `web/${relative(webRoot, path).split(sep).join("/")}`, sha256: "" }));
  const css = assets
    .filter((path) => path.endsWith(".css"))
    .map((path) => ({ path: `web/${relative(webRoot, path).split(sep).join("/")}`, sha256: "" }));
  if (js.length === 0 || css.length === 0) throw new Error("artifact_web_assets_missing");
  for (const file of [...js, ...css]) file.sha256 = await digest(join(root, file.path));

  const sdkPath = join(
    root,
    "claude-sdk",
    "node_modules",
    "@anthropic-ai",
    "claude-agent-sdk",
    "package.json",
  );
  const sdkPackage = JSON.parse(await readFile(sdkPath, "utf8")) as { name?: string; version?: string };
  if (sdkPackage.name !== "@anthropic-ai/claude-agent-sdk" || !sdkPackage.version)
    throw new Error("sdk_identity_unverified");
  const index = { path: "web/index.html", sha256: await digest(indexPath) };
  return {
    directory: root,
    binary: { path: "tau", sha256: await digest(binaryPath) },
    version,
    platform: { os, arch },
    web: { index, js, css },
    sdk: { name: sdkPackage.name, version: sdkPackage.version },
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const manifest = {
    version: 1,
    baseline: await describe(args.baseline, args.os, args.arch),
    candidate: await describe(args.candidate, args.os, args.arch),
  };
  parseArtifactManifest(manifest);
  await writeFile(args.output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "manifest_creation_failed");
    process.exitCode = 2;
  });
}
