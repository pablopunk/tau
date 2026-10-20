import type { ConversationSummary } from "@tau/protocol";
import type { LifecycleDeps } from "../lifecycle/deps";
import type { RunCommand } from "./command-runner";
import type { FetchLike, Release } from "./latest-version";
import type { JobReporter } from "./job-child";
import type { LinkedNodes } from "./nodes-behind";

export interface UpdateDeps extends LifecycleDeps {
  readonly err: (message: string) => void;
  readonly runCommand: RunCommand;
  readonly latestVersion: () => Promise<string>;
  readonly listConversations: (home: string) => Promise<readonly ConversationSummary[]>;
  readonly confirm: (question: string) => Promise<boolean>;
  readonly isTty: boolean;
  /** This process's pid; default `process.pid`. */
  readonly pid?: number;
  /** Set while running as the detached updater child. */
  readonly job?: JobReporter;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The install root (`current` and `versions/`); undefined in a dev checkout or the Node build. */
  readonly installRoot: string | undefined;
  readonly platformKey: string | undefined;
  readonly fetch: FetchLike;
  /** The release `version` as installable assets for this platform; throws when it is not (yet) published. */
  readonly findRelease: (version: string, home: string) => Promise<Release>;
  /** Best effort, POSIX only; absent elsewhere. */
  readonly ancestorPids?: () => Promise<readonly number[]>;
  /**
   * Polls `GET /api/update` until `current === version` or `timeoutMs` passes. Resolves to the last `current`
   * seen (undefined: the server never answered). `/api/health` cannot tell the old server from the new one.
   */
  readonly pollRunningVersion: (home: string, version: string, timeoutMs: number) => Promise<string | undefined>;
  readonly hasHubFile: (home: string) => boolean;
  /** Best effort: the linked nodes of a running hub, or undefined. */
  readonly linkedNodes?: (home: string) => Promise<LinkedNodes | undefined>;
}
