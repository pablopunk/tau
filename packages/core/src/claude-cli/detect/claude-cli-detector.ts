import type { ClaudeCliStatus, ClaudeCliUsage } from "@tau/protocol";
import type { ClaudeCliClock } from "../clock";
import type { ClaudeSdkLoader } from "../sdk-types";
import { claudeCliStatusOf } from "../status";
import { readCliVersion } from "./claude-cli-version";
import { failureMessage, isMissingBinary, stateOfAuth } from "./detection-state";

const BACKGROUND_INTERVAL_MS = 60_000;

type Environment = Readonly<Record<string, string | undefined>>;

export interface ClaudeCliDetectorDeps {
  readonly sdk: ClaudeSdkLoader;
  /** `Settings.claudeCliNoticeAt`. */
  readonly noticeAt: () => Promise<number | null>;
  readonly usage: () => ClaudeCliUsage | null;
  /** Called when the state changed; the service emits `{ resource: "providers" }`. */
  readonly onChange: () => void;
  readonly clock: ClaudeCliClock;
  /** Where `TAU_CLAUDE_PATH` is read for `claude --version`. Defaults to the process environment. */
  readonly env?: Environment;
  readonly installedVersion?: () => Promise<string | null>;
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

const sameStatus = (a: ClaudeCliStatus, b: ClaudeCliStatus): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

async function bundledVersionOf(sdk: ClaudeSdkLoader): Promise<string | null> {
  try {
    return await (await sdk()).bundledCliVersion();
  } catch {
    return null;
  }
}

export function createClaudeCliDetector(deps: ClaudeCliDetectorDeps): ClaudeCliDetector {
  const installedVersion = deps.installedVersion ?? (() => readCliVersion(deps.env ?? process.env));
  let last = claudeCliStatusOf("missing");
  let running: Promise<ClaudeCliStatus> | null = null;
  let cancelTimer: (() => void) | null = null;

  const current = (): ClaudeCliStatus => ({ ...last, usage: deps.usage() });

  function publish(next: ClaudeCliStatus): void {
    const changed = !sameStatus(last, next);
    last = next;
    if (changed) deps.onChange();
  }

  async function detect(): Promise<ClaudeCliStatus> {
    try {
      const port = await deps.sdk();
      const [auth, noticeAt, cliVersion, sdkCliVersion] = await Promise.all([
        port.authStatus(),
        deps.noticeAt(),
        installedVersion(),
        bundledVersionOf(deps.sdk),
      ]);
      return claudeCliStatusOf(stateOfAuth(auth, noticeAt !== null), {
        plan: auth.subscriptionType,
        org: auth.orgName,
        cliVersion,
        sdkCliVersion,
      });
    } catch (error) {
      if (isMissingBinary(error)) return claudeCliStatusOf("missing");
      return { ...last, message: failureMessage(error) };
    }
  }

  function check(): Promise<ClaudeCliStatus> {
    running ??= detect()
      .then(publish)
      .then(current)
      .finally(() => {
        running = null;
      });
    return running;
  }

  function schedule(): void {
    cancelTimer = deps.clock.setTimer(() => {
      void check().finally(() => {
        if (cancelTimer) schedule();
      });
    }, BACKGROUND_INTERVAL_MS);
  }

  return {
    status: current,
    refresh: check,
    start() {
      if (cancelTimer) return;
      schedule();
      void check();
    },
    stop() {
      cancelTimer?.();
      cancelTimer = null;
    },
  };
}
