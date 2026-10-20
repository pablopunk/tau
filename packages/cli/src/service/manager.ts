import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CliCommand } from "../cli-entry";
import type { DefinitionFile, ServiceBackend, ServiceState } from "./backend";
import type { ServiceContext } from "./context";
import { type DetachedOptions, ForegroundHolderError } from "./detached";
import { detachedBackendOf, FALLBACK_WARNING, nativeBackendOf } from "./pick-backend";
import { providerKeyNotice, shellOnlyProviderKeys } from "./provider-keys";
import { buildSpec, recordFileOf, type ServiceSpec } from "./spec";

/** What `service.json` holds: the program and arguments the unit was written for. */
export interface RecordedPaths {
  readonly command: string;
  readonly args: readonly string[];
}

const sameAsSpec = (recorded: RecordedPaths | undefined, spec: ServiceSpec): boolean =>
  recorded !== undefined &&
  recorded.command === spec.command &&
  recorded.args.length === spec.args.length &&
  recorded.args.every((argument, index) => argument === spec.args[index]);

export interface ServiceManager {
  readonly spec: ServiceSpec;
  /** The backend that runs tau here: the native one when installed, else detached. */
  readonly kind: ServiceBackend["kind"];
  /** The OS has a native service manager (false: only a detached process is possible). */
  readonly native: boolean;
  installed(): Promise<boolean>;
  recorded(): RecordedPaths | undefined;
  /** Installed, but the recorded command is not the current one. */
  needsRepair(): Promise<boolean>;
  install(): Promise<string[]>;
  uninstall(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Copies PATH again; reloads the definition when it changed. */
  restart(): Promise<void>;
  state(): Promise<ServiceState & { kind: ServiceBackend["kind"] }>;
}

function writeFiles(files: readonly DefinitionFile[]): boolean {
  let changed = false;
  for (const file of files) {
    const current = existsSync(file.path) ? readFileSync(file.path) : undefined;
    const next = Buffer.from(file.content);
    if (current?.equals(next)) continue;
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, next);
    changed = true;
  }
  return changed;
}

function readRecord(home: string): RecordedPaths | undefined {
  try {
    const value = JSON.parse(readFileSync(recordFileOf(home), "utf8")) as Partial<RecordedPaths>;
    const { command, args } = value;
    // an old `{ node, entry }` record has no `command`: it reads as missing, so one repair rewrites it
    return typeof command === "string" && Array.isArray(args) && args.every((a) => typeof a === "string")
      ? { command, args }
      : undefined;
  } catch {
    return undefined;
  }
}

export function createServiceManager(
  context: ServiceContext,
  cli: CliCommand,
  home: string,
  detachedOptions: DetachedOptions = {},
): ServiceManager {
  const spec = buildSpec(context, cli, home);
  const native = nativeBackendOf(context);
  const detached = detachedBackendOf(context, detachedOptions);

  const installed = async () => (native ? native.isInstalled(spec) : false);
  const activeBackend = async () => ((await installed()) && native ? native : detached);

  function record() {
    mkdirSync(home, { recursive: true });
    writeFileSync(recordFileOf(home), JSON.stringify({ command: spec.command, args: spec.args }));
  }

  async function refuseForegroundHolder(spare: number | undefined) {
    const holder = await detached.foregroundHolder(spec);
    if (holder !== undefined && holder !== spare) throw new ForegroundHolderError(holder);
  }

  async function installNatively(backend: ServiceBackend): Promise<string[]> {
    writeFiles(backend.files(spec));
    const outcome = await backend.install(spec);
    if (!outcome.fellBack) return [...outcome.warnings];
    for (const file of backend.files(spec)) rmSync(file.path, { force: true });
    await detached.install(spec);
    return [...outcome.warnings];
  }

  return {
    spec,
    kind: native?.kind ?? detached.kind,
    native: native !== undefined,
    installed,
    recorded: () => readRecord(home),
    async needsRepair() {
      const recorded = readRecord(home);
      if (!native) return recorded !== undefined && !sameAsSpec(recorded, spec);
      if (!(await installed())) return false;
      return !sameAsSpec(recorded, spec);
    },
    async install() {
      record();
      const warnings = [providerKeyNotice(shellOnlyProviderKeys(context.env))];
      const held = native && (await detached.lockHolder(spec)) !== undefined;
      const nativePid = held && native ? (await native.state(spec)).pid : undefined;
      await detached.stopExcept(spec, nativePid);
      await refuseForegroundHolder(nativePid);
      if (!native) {
        await detached.install(spec);
        return [FALLBACK_WARNING, ...warnings].filter((line): line is string => line !== undefined);
      }
      const installWarnings = await installNatively(native);
      return [...installWarnings, ...warnings].filter((line): line is string => line !== undefined);
    },
    async uninstall() {
      await detached.stop(spec);
      if (native) {
        await native.uninstall(spec);
        for (const file of native.files(spec)) rmSync(file.path, { force: true });
      }
      rmSync(recordFileOf(home), { force: true });
    },
    async start() {
      await (await activeBackend()).start(spec);
    },
    async stop() {
      await (await activeBackend()).stop(spec);
    },
    async restart() {
      if (!(await installed()) || !native) return (await activeBackend()).restart(spec);
      const changed = writeFiles(native.files(spec));
      record();
      await (changed ? native.reload(spec) : native.restart(spec));
    },
    async state() {
      const backend = await activeBackend();
      return { ...(await backend.state(spec)), kind: backend.kind };
    },
  };
}

/** Every tau service of this user, dev homes included. */
export async function listServices(context: ServiceContext): Promise<string[]> {
  return (await nativeBackendOf(context)?.list()) ?? [];
}

/** Removes the service of one home without needing the current CLI paths. */
export async function uninstallHome(context: ServiceContext, home: string): Promise<void> {
  await createServiceManager(context, { command: "", args: [] }, home).uninstall();
}
