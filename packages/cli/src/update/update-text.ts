import type { RunningWork } from "./running-work";

export const LAG_NOTE = "A release shows up here once its archive and SHA256SUMS are published.";
export const LINKED_NOTE = "Linked nodes must run the same tau version: run `tau update` on each.";
export const LINKED_HUB_NOTE = "This tau is linked to other nodes: update every node to the same version.";
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

export const failedInstallText = (problem: string, manual: string): string =>
  `The install failed: ${problem}\nNothing changed: the old version still runs. Or run: ${manual}`;

export const rolledBackText = (target: string, previous: string): string =>
  `Rolled back to tau ${previous}: version ${target} did not come up.`;

export const noRollbackText = (target: string): string =>
  `There is no previous version to go back to: version ${target} stays installed.`;

export const skewText = (running: string | undefined, target: string): string =>
  `The server still reports version ${running ?? "none"}, expected ${target}. Check \`tau status\` and \`tau logs\`.`;
