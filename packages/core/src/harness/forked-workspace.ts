import type { ThreadWorkspace } from "@tau/protocol";

export const forkedWorkspace = (parent: ThreadWorkspace | undefined): ThreadWorkspace | undefined =>
  parent && { ...parent, state: "ready", mergedSha: null, pullRequestUrl: null };
