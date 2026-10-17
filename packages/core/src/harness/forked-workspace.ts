import type { ThreadWorkspace } from "@pi-everywhere/protocol";

export const forkedWorkspace = (parent: ThreadWorkspace | undefined): ThreadWorkspace | undefined =>
  parent && { ...parent, state: "ready", mergedSha: null, pullRequestUrl: null };
