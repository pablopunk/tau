import type { ClaudeCliStatus, ClaudeCliUsage } from "@tau/protocol";
import type { ClaudeCliClock } from "../clock";
import type { ClaudeSdkLoader } from "../sdk-types";
import { claudeCliStatusOf } from "../status";

/** Owner A. Frozen signature; the body is a placeholder that always reports `missing`. */
export interface ClaudeCliDetectorDeps {
  readonly sdk: ClaudeSdkLoader;
  /** `Settings.claudeCliNoticeAt`. */
  readonly noticeAt: () => Promise<number | null>;
  readonly usage: () => ClaudeCliUsage | null;
  /** Called when the state changed; the service emits `{ resource: "providers" }`. */
  readonly onChange: () => void;
  readonly clock: ClaudeCliClock;
}

export interface ClaudeCliDetector {
  /** The last known status, never blocks. Stays stale while a check runs. */
  status(): ClaudeCliStatus;
  /** One check now. Never rejects: a timeout or parse failure keeps the last state and sets `message`. */
  refresh(): Promise<ClaudeCliStatus>;
  /** Background check every 60 s. */
  start(): void;
  stop(): void;
}

export function createClaudeCliDetector(_deps: ClaudeCliDetectorDeps): ClaudeCliDetector {
  const status = claudeCliStatusOf("missing");
  return { status: () => status, refresh: async () => status, start: () => undefined, stop: () => undefined };
}
