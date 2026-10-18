import type { ClaudeCliStatus, ClaudeCliUsage } from "@tau/protocol";

export const CLAUDE_CLI_NOTICE = "Runs the Claude Agent SDK under your own Claude login, for your own use.";

const PRODUCT_NAME = /claude code/gi;

export const withoutProductName = (text: string): string => text.replace(PRODUCT_NAME, "claude CLI");

const joinParts = (parts: (string | null | undefined)[]): string => parts.filter(Boolean).join(" · ");

const planAndOrg = (cli: ClaudeCliStatus): (string | null)[] => [cli.plan, cli.org];

const BADGE_BY_STATE: Partial<Record<ClaudeCliStatus["state"], string>> = {
  missing: "claude CLI not found",
  logged_out: "Not logged in",
  not_plan: "API key login",
  blocked: "Blocked by your organization",
  error: "Check failed",
};

export function claudeCliBadge(cli: ClaudeCliStatus): { label: string; destructive: boolean } {
  const destructive = cli.state === "blocked";
  if (cli.state === "ready")
    return { label: joinParts(["Connected via claude CLI", ...planAndOrg(cli)]), destructive };
  if (cli.state === "needs_notice")
    return { label: joinParts(["Detected", ...planAndOrg(cli)]), destructive };
  return { label: BADGE_BY_STATE[cli.state] ?? "Check failed", destructive };
}

const clockOf = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

const resetsText = (usage: ClaudeCliUsage): string | null =>
  usage.resetsAt === null ? null : `resets ${clockOf(usage.resetsAt)}`;

export function claudeCliUsageNote(usage: ClaudeCliUsage): string | null {
  if (usage.status === "rejected") return joinParts(["Plan limit reached", resetsText(usage)]);
  if (usage.fiveHour === null) return null;
  return joinParts([`5-hour ${Math.round(usage.fiveHour)}%`, resetsText(usage)]);
}

export const isUsageWarning = (cli: ClaudeCliStatus): boolean => cli.usage?.status === "allowed_warning";

const versionNote = (cli: ClaudeCliStatus): string | null =>
  cli.cliVersion && cli.sdkCliVersion && cli.cliVersion !== cli.sdkCliVersion
    ? `tau uses ${cli.sdkCliVersion}`
    : null;

const STATIC_NOTE: Partial<Record<ClaudeCliStatus["state"], string>> = {
  needs_notice: "Claude Agent SDK, under your own login.",
  missing: "Install the claude CLI and log in.",
  logged_out: "Run `claude`, then `/login`, on this machine.",
  not_plan: "The CLI uses an API key. Use the Anthropic provider.",
};

function readyNote(cli: ClaudeCliStatus): string | null {
  const usage = cli.usage ? claudeCliUsageNote(cli.usage) : null;
  return joinParts([usage, cli.cliVersion ? `CLI ${cli.cliVersion}` : null, versionNote(cli)]) || null;
}

export function claudeCliNote(cli: ClaudeCliStatus): string | null {
  if (cli.state === "ready") return readyNote(cli);
  const fixed = STATIC_NOTE[cli.state];
  if (fixed) return fixed;
  return cli.message ? withoutProductName(cli.message) : null;
}

export type ClaudeCliAction = "acknowledge" | "refresh";

export function claudeCliAction(cli: ClaudeCliStatus): ClaudeCliAction {
  return cli.state === "needs_notice" ? "acknowledge" : "refresh";
}

export const claudeCliActionLabel = (action: ClaudeCliAction): string =>
  action === "acknowledge" ? "I understand" : "Check again";
