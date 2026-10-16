const HOSTNAME = "github.com";

export const STATUS_ARGS = ["auth", "status", "--hostname", HOSTNAME, "--active", "--json", "hosts"];

const REPOS_ENDPOINT =
  "user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member";

const REPOS_PROJECTION =
  "[.[] | select((.archived or .disabled)|not) | {full_name, private, pushed_at, clone_url, ssh_url, description}]";

export const REPOS_ARGS = ["api", "--hostname", HOSTNAME, REPOS_ENDPOINT, "--jq", REPOS_PROJECTION];
