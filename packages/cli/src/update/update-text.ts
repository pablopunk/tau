import type { RunningWork } from "./running-work";

export const LAG_NOTE = "A release can take 1-3 minutes to show up in the npm registry.";
export const LINKED_NOTE = "Linked nodes must run the same tau version: run `tau update` on each.";
export const LINKED_HUB_NOTE =
  "This tau is linked to a hub: update the hub and every node to the same version.";
export const INSIDE_TAU =
  "You are running inside tau; restarting would kill this command. Run `tau restart` from a normal terminal, or pass `--no-restart`.";
export const NON_TTY_NEEDS_YES = "Not a terminal. Add --yes to skip the question.";
export const FOREGROUND_NOTE = "tau runs in the foreground: restart it yourself (Ctrl-C, then `tau`).";
export const NOT_RUNNING_NOTE = "tau is not running: start it with `tau start`.";

const names = (items: readonly { title: string }[]) => items.map((item) => `  - ${item.title}`);

export function runningWorkText(work: RunningWork): string {
  const lines = [`Running threads: ${work.threads.length}, subagents: ${work.subagents.length}.`];
  lines.push(...names(work.threads), ...names(work.subagents));
  lines.push(
    "A restart resumes or aborts turns on startup, ends terminals and background processes, and the page reconnects in seconds.",
    "Add --force to restart anyway.",
  );
  return lines.join("\n");
}

export const resumingText = (work: RunningWork): string | undefined =>
  work.resuming.length > 0
    ? `${work.resuming.length} thread(s) with timers or a goal will resume after the restart.`
    : undefined;

export const failedInstallText = (manual: string, rollback: string): string =>
  `The install failed. Run it yourself: ${manual}\nTo go back: ${rollback}`;

export const permissionText = (manual: string): string =>
  `Permission denied. Fix the permissions of the npm prefix (or use a node version manager), then run: ${manual}`;

export const verifyFailedText = (problem: string, rollback: string): string =>
  `The update did not verify: ${problem}\nNothing was restarted: the old server still runs on old in-memory code and files on disk may be inconsistent. Re-run \`tau update\`, or go back with: ${rollback}`;

export const skewText = (running: string | undefined, target: string): string =>
  `The server still reports version ${running ?? "none"}, expected ${target}. Check \`tau status\` and \`tau logs\`.`;
