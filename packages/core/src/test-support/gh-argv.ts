export const GH_HOSTNAME = "github.com";

export const GH_STATUS_ARGV = [
  "auth",
  "status",
  "--hostname",
  GH_HOSTNAME,
  "--active",
  "--json",
  "hosts",
] as const;

export const GH_REPOS_ENDPOINT =
  "user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member";

export const GH_REPOS_JQ =
  "[.[] | select((.archived or .disabled)|not) | {full_name, private, pushed_at, clone_url, ssh_url, description}]";

export const GH_REPOS_ARGV = [
  "api",
  "--hostname",
  GH_HOSTNAME,
  GH_REPOS_ENDPOINT,
  "--jq",
  GH_REPOS_JQ,
] as const;

/** The only argument lists the fake `gh` answers; anything else exits 2 with "fake gh: unexpected arguments". */
export const FAKE_GH_ARGV = [GH_STATUS_ARGV, GH_REPOS_ARGV] as const;
