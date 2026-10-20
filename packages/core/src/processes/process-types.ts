import type { ProcessInfo } from "@tau/protocol";

/** Why a command was stopped by tau. First reason wins when two race. */
export type StopReason = "user" | "timeout" | "resources" | "memory";

export interface ExitDetails {
  readonly exitCode: number | null;
  readonly stopRequested: boolean;
  readonly stopReason?: StopReason;
  readonly logTail: string;
}

export type ForegroundOutcome =
  | {
      readonly kind: "exited";
      readonly exitCode: number | null;
      readonly stopRequested: boolean;
      readonly stopReason?: StopReason;
    }
  /** The process runs on, listed and announced like one the agent started in the background. */
  | { readonly kind: "background"; readonly info: ProcessInfo };

export interface ForegroundRun {
  readonly id: string;
  readonly logPath: string;
  readonly outcome: Promise<ForegroundOutcome>;
  /** Settles at spawn attempt or cancel; already settled when the command was not queued. */
  readonly admitted: Promise<void>;
  /** SIGTERM, SIGKILL after the grace period. */
  stop(): Promise<void>;
  /** After `exited`: forgets the run. The log stays when `keepLog`. */
  release(keepLog: boolean): Promise<void>;
}
