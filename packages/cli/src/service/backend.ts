import type { ServiceSpec } from "./spec";

export interface DefinitionFile {
  readonly path: string;
  readonly content: string | Buffer;
}

export interface ServiceState {
  readonly active: boolean;
  /** The pid the manager reports, when it reports one. */
  readonly pid?: number;
}

export interface InstallOutcome {
  readonly warnings: readonly string[];
  /** The OS could not host the service; a detached process runs instead. */
  readonly fellBack?: boolean;
}

/** One way to keep tau running. `install` assumes `files(spec)` are already on disk. */
export interface ServiceBackend {
  readonly kind: "launchd" | "systemd" | "schtasks" | "detached";
  files(spec: ServiceSpec): DefinitionFile[];
  isInstalled(spec: ServiceSpec): Promise<boolean>;
  install(spec: ServiceSpec): Promise<InstallOutcome>;
  uninstall(spec: ServiceSpec): Promise<void>;
  /** The definition changed on disk: make the running service use it. */
  reload(spec: ServiceSpec): Promise<void>;
  start(spec: ServiceSpec): Promise<void>;
  stop(spec: ServiceSpec): Promise<void>;
  restart(spec: ServiceSpec): Promise<void>;
  state(spec: ServiceSpec): Promise<ServiceState>;
  /** Names of every tau service of this user. */
  list(): Promise<string[]>;
}

export class ServiceCommandError extends Error {
  constructor(command: string, stderr: string) {
    super(`${command} failed: ${stderr.trim() || "no output"}`);
    this.name = "ServiceCommandError";
  }
}
