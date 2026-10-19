import { delimiter, dirname, join } from "node:path";
import { compareVersions } from "@tau/protocol";
import { temporaryRunnerOf } from "../service/entry-guard";
import type { RunCommand } from "../update/command-runner";
import { globalPackagePath, globalRoot } from "../update/global-package";
import { entryOfPackage } from "../update/install-method";
import { npmOf, PACKAGE_NAME } from "../update/latest-version";
import { permissionText } from "../update/update-text";
import { verifyInstall } from "../update/verify-install";
import * as text from "./bare-text";
import type { LifecycleDeps } from "./deps";
import { lifecycleFlagsOf } from "./flags";

/** What bootstrap needs beyond LifecycleDeps; real wiring in `realBootstrapDeps`, fakes in tests. */
export interface BootstrapDeps {
  readonly runCommand: RunCommand;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly execPath: string;
  /** `realpath(argv[1])`. */
  readonly entry: string;
  readonly platform: NodeJS.Platform;
  readonly readPackageVersion: (packageDir: string) => string | undefined;
  readonly realpath: (path: string) => string;
  /** Resolves `node` from PATH (bunx runs under bun); undefined when there is none. */
  readonly nodeOnPath: () => string | undefined;
}

export type BootstrapResult =
  /** Not a temporary runner (or already bootstrapped): carry on in this process. */
  | { readonly kind: "skip" }
  /** The global tau ran the command; this process exits with `code`. */
  | { readonly kind: "handedOver"; readonly code: number }
  /** Print `message` and exit 1. */
  | { readonly kind: "failed"; readonly message: string };

const DROPPED_ENV = /^(npm_config_|npm_lifecycle_|npm_package_)/;

/** npx sets npm_config_* and friends; the install must target the real global prefix. */
export function cleanEnvOf(env: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const keepPrefix = env.TAU_BOOTSTRAP_SPEC !== undefined;
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || key === "npm_execpath" || key === "TAU_BOOTSTRAPPED") continue;
    if (DROPPED_ENV.test(key) && !(keepPrefix && key === "npm_config_prefix")) continue;
    clean[key] = value;
  }
  return clean;
}

const isBun = (execPath: string) => /(^|[\\/])bun(\.exe)?$/.test(execPath);
const cmdName = (name: string, platform: NodeJS.Platform) => (platform === "win32" ? `${name}.cmd` : name);

interface Manager {
  readonly command: string;
  readonly installArgs: readonly string[];
  readonly manual: string;
}

async function pnpmAnswers(run: RunCommand, platform: NodeJS.Platform, env: NodeJS.ProcessEnv) {
  const result = await run(cmdName("pnpm", platform), ["--version"], {
    stdio: "capture",
    timeoutMs: 15_000,
    env,
  });
  return result.code === 0;
}

async function managerOf(
  boot: BootstrapDeps,
  runner: "npx" | "pnpm" | "bun",
  node: string,
  env: NodeJS.ProcessEnv,
  spec: string,
): Promise<Manager> {
  if (runner === "pnpm" && (await pnpmAnswers(boot.runCommand, boot.platform, env))) {
    return {
      command: cmdName("pnpm", boot.platform),
      installArgs: ["add", "-g", spec],
      manual: `pnpm add -g ${spec}`,
    };
  }
  const npm = boot.platform === "win32" ? join(dirname(node), "npm.cmd") : npmOf(node);
  return { command: npm, installArgs: ["i", "-g", spec], manual: `npm i -g ${spec}` };
}

const failed = (message: string): BootstrapResult => ({ kind: "failed", message });

function onPath(deps: LifecycleDeps, boot: BootstrapDeps): boolean {
  const names = boot.platform === "win32" ? ["tau.cmd", "tau.exe", "tau"] : ["tau"];
  const dirs = (boot.env.PATH ?? "").split(boot.platform === "win32" ? ";" : delimiter);
  return dirs.some((dir) => dir && names.some((name) => deps.fileExists(join(dir, name))));
}

/** npx / pnpm dlx / bunx: install this version globally, verify it, and hand over to it (BARE-INSTALL.md section 2). */
export async function bootstrap(
  deps: LifecycleDeps,
  boot: BootstrapDeps | undefined,
  argv: readonly string[],
): Promise<BootstrapResult> {
  const bootstrapped = (boot?.env ?? process.env).TAU_BOOTSTRAPPED === "1";
  delete process.env.TAU_BOOTSTRAPPED;
  delete deps.context.env.TAU_BOOTSTRAPPED;
  if (!boot) return { kind: "skip" };
  const runner = temporaryRunnerOf(boot.entry);
  if (runner === undefined) return { kind: "skip" };
  const version = deps.version();
  const realSpec = `${PACKAGE_NAME}@${version}`;
  if (bootstrapped) return failed(text.globalInstallFailedWith(`npm i -g ${realSpec}`));
  const env = cleanEnvOf(boot.env);
  const spec = boot.env.TAU_BOOTSTRAP_SPEC ?? realSpec;
  const node = isBun(boot.execPath) ? boot.nodeOnPath() : boot.execPath;
  if (node === undefined) return failed(text.NO_NODE_ON_PATH(`npm i -g ${realSpec}`));
  const manager = await managerOf(boot, runner, node, env, spec);
  const manual = manager.manual.replace(spec, realSpec);
  const root = await globalRoot(boot.runCommand, manager.command, env);
  if (root === undefined) return failed(text.globalInstallFailedWith(manual));
  const installed = boot.readPackageVersion(globalPackagePath(root));
  const installNeeded = installed === undefined || compareVersions(installed, version) < 0;
  if (!installNeeded && compareVersions(installed, version) > 0) {
    deps.out(text.newerGlobalNote(installed, version));
  }
  if (installNeeded) {
    deps.out(text.installingGlobally(version, manual));
    const result = await boot.runCommand(manager.command, manager.installArgs, { stdio: "tee", env });
    if (result.code !== 0) {
      const permission = /EACCES|EPERM/.test(result.stderr);
      return failed(
        permission
          ? `${permissionText(manual)}\n${text.PREFIX_HINT(realSpec)}`
          : text.globalInstallFailedWith(manual),
      );
    }
  }
  let packageDir: string;
  try {
    packageDir = boot.realpath(globalPackagePath(root));
  } catch {
    return failed(text.globalInstallFailedWith(manual));
  }
  const home = lifecycleFlagsOf(argv, deps.context).home;
  if (installNeeded) {
    const withEnv: RunCommand = (command, args, options) =>
      boot.runCommand(command, args, { ...options, env });
    const problem = await verifyInstall(
      { ...boot, runCommand: withEnv, execPath: node },
      packageDir,
      version,
      home,
    );
    if (problem) return failed(text.bootstrapVerifyFailed(problem, manual));
  }
  const handed = await boot.runCommand(node, [entryOfPackage(packageDir), ...argv], {
    stdio: "inherit",
    env: { ...env, TAU_BOOTSTRAPPED: "1" },
  });
  const code = handed.code ?? 1;
  if (code === 0 && installNeeded && !onPath(deps, boot)) deps.out(text.NOT_ON_PATH);
  return { kind: "handedOver", code };
}
