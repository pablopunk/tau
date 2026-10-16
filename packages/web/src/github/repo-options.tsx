import type { GithubRepo, GithubStatus } from "@pi-everywhere/protocol";
import { LockIcon } from "lucide-react";
import type { ComboboxOption } from "@/components/ui/combobox";
import { RelativeTime } from "@/components/ui/relative-time";

export const GITHUB_GROUP = "On GitHub";
const PREFIX = "github:";
const HINT_VALUE = `${PREFIX}hint`;

export const githubValue = (nameWithOwner: string) => `${PREFIX}${nameWithOwner}`;

export const parseGithubValue = (value: string): string | null =>
  value.startsWith(PREFIX) && value !== HINT_VALUE ? value.slice(PREFIX.length) : null;

const repoHint = (repo: GithubRepo, now: number) => (
  <>
    {repo.localPath ? "local · " : null}
    <RelativeTime at={repo.pushedAt} now={now} />
  </>
);

export const repoOption = (repo: GithubRepo, now = Date.now()): ComboboxOption => ({
  value: githubValue(repo.nameWithOwner),
  label: repo.nameWithOwner,
  group: GITHUB_GROUP,
  hint: repoHint(repo, now),
  ...(repo.description && { description: repo.description }),
  ...(repo.private && { icon: <LockIcon aria-label="Private" className="size-3.5" /> }),
});

export function statusHint(status: GithubStatus): string | null {
  if (status.state === "connected") return null;
  if (status.state === "not_installed") return "Install the GitHub CLI (gh) to list your repos.";
  if (status.state === "not_logged_in") return status.hint;
  return status.message;
}

const hintOption = (label: string): ComboboxOption => ({
  value: HINT_VALUE,
  label,
  group: GITHUB_GROUP,
  disabled: true,
});

interface GithubOptionsInput {
  status: GithubStatus | undefined;
  repos: GithubRepo[] | undefined;
  reposFailed: boolean;
}

export function githubOptions({ status, repos, reposFailed }: GithubOptionsInput): ComboboxOption[] {
  if (!status) return [];
  const hint = statusHint(status);
  if (hint) return [hintOption(hint)];
  if (reposFailed) return [hintOption("Could not load your GitHub repos.")];
  return (repos ?? []).map((repo) => repoOption(repo));
}
