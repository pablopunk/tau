export const ASK_TO_COMMIT =
  "Please commit all your changes in this worktree with a clear commit message, so I can merge it.";

export const askToResolve = (base: string) =>
  `Please rebase this branch onto ${base}, fix any conflicts, and continue the rebase until it finishes.`;
