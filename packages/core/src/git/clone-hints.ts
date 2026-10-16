const HINTS: readonly (readonly [RegExp, string])[] = [
  [/could not read Username/i, "Run `gh auth setup-git`."],
  [/Permission denied \(publickey\)/i, "Check that your SSH key is added to GitHub and to your ssh-agent."],
  [/Host key verification failed/i, "Run `ssh -T git@github.com` once to trust GitHub."],
  [/SAML|SSO/, "Authorize your token for the organization on GitHub."],
];

/** Appends a fix to the last stderr line of a failed clone when it is a known failure. */
export function withCloneHint(error: string): string {
  const hint = HINTS.find(([pattern]) => pattern.test(error))?.[1];
  return hint === undefined ? error : `${error} (${hint})`;
}
