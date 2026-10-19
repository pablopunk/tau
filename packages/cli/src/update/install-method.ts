import { dirname, join } from "node:path";
import { npmOf, PACKAGE_NAME } from "./latest-version";

export interface Command {
  readonly command: string;
  readonly args: readonly string[];
}

export type InstallMethod =
  | {
      readonly kind: "npm";
      readonly packageDir: string;
      readonly install: Command;
      readonly manualCommand: string;
      readonly hint: string | undefined;
    }
  | { readonly kind: "pnpm"; readonly install: Command; readonly manualCommand: string }
  | { readonly kind: "manual"; readonly reason: string; readonly manualCommand: string | undefined };

export interface InstallProbe {
  /** `realpath(argv[1])`. */
  readonly entry: string;
  readonly execPath: string;
  readonly platform: NodeJS.Platform;
  readonly target: string;
}

const NPM_LAYOUT = /\/lib\/node_modules\/@pablopunk\/tau\/dist\/bin\.js$/;
const SHIM_MANAGERS = /\/(mise|asdf)\//;

const manual = (reason: string, manualCommand?: string): InstallMethod => ({
  kind: "manual",
  reason,
  manualCommand,
});

function refusalOf(entry: string, target: string): string | undefined {
  const spec = `${PACKAGE_NAME}@${target}`;
  if (entry.includes("/.bun/")) return `Installed with bun. Run: bun add -g ${spec}`;
  if (entry.includes("/.volta/")) return `Installed with volta. Run: volta install ${spec}`;
  if (/\/_npx\/|\/dlx\/|\/\.bun\/install\/cache\//.test(entry) || entry.includes("/_npx/")) {
    return "Running from a temporary npx/dlx cache: nothing to update. Run `npx @pablopunk/tau@latest` again.";
  }
  if (/\/packages\/cli\/dist\/bin\.js$/.test(entry))
    return "Running from a development checkout: update it with git.";
  return undefined;
}

/** Which package manager owns this tau, from where the running entry file lives. Never guesses. */
export function installMethodOf(probe: InstallProbe): InstallMethod {
  const { entry, target } = probe;
  const spec = `${PACKAGE_NAME}@${target}`;
  if (probe.platform === "win32") {
    return manual("Automatic update is not supported on Windows.", `npm i -g ${spec}`);
  }
  const refusal = refusalOf(entry, target);
  if (refusal) return manual(refusal);
  if (entry.includes("/.pnpm/") || /\/pnpm\/global\//.test(entry)) {
    return {
      kind: "pnpm",
      install: { command: "pnpm", args: ["add", "-g", spec] },
      manualCommand: `pnpm add -g ${spec}`,
    };
  }
  if (!NPM_LAYOUT.test(entry)) return manual(`Unknown install layout: ${entry}`, `npm i -g ${spec}`);
  return {
    kind: "npm",
    packageDir: dirname(dirname(entry)),
    install: { command: npmOf(probe.execPath), args: ["i", "-g", spec] },
    manualCommand: `npm i -g ${spec}`,
    hint: SHIM_MANAGERS.test(entry) ? "If `tau` is missing afterwards, run `mise reshim`." : undefined,
  };
}

export const entryOfPackage = (packageDir: string): string => join(packageDir, "dist", "bin.js");
