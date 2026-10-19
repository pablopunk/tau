import type { LockInfo } from "@tau/core";
import type { ConversationSummary } from "@tau/protocol";
import type { LifecycleDeps } from "../lifecycle/deps";
import type { RunCommand } from "./command-runner";
import type { LinkedMachines } from "./machines-behind";

export interface UpdateDeps extends LifecycleDeps {
  readonly err: (message: string) => void;
  readonly runCommand: RunCommand;
  readonly latestVersion: () => Promise<string>;
  readonly listConversations: (home: string) => Promise<readonly ConversationSummary[]>;
  readonly confirm: (question: string) => Promise<boolean>;
  readonly isTty: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly execPath: string;
  /** `realpath(argv[1])`. */
  readonly entry: string;
  readonly readPackageVersion: (packageDir: string) => string | undefined;
  readonly realpath: (path: string) => string;
  /** Best effort, POSIX only; absent elsewhere. */
  readonly ancestorPids?: () => Promise<readonly number[]>;
  /** Waits (up to the deadline) for the lock to report `version`; the last lock seen otherwise. */
  readonly pollInstance: (home: string, version: string) => Promise<LockInfo | undefined>;
  readonly hasHubFile: (home: string) => boolean;
  /** Best effort: the linked machines of a running hub, or undefined. */
  readonly linkedMachines?: (home: string) => Promise<LinkedMachines | undefined>;
}
