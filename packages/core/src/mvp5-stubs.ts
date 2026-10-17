import type { Core } from "@pi-everywhere/protocol";
import { notImplemented } from "./not-implemented";

const reject = (what: string) => async (): Promise<never> => {
  throw notImplemented(what);
};

export const conversationStubs: Pick<
  Core["conversations"],
  "fork" | "rewindPreview" | "rewind" | "cancelQueued" | "checkpoints" | "checkpointDiff"
> = {
  fork: reject("conversations.fork"),
  rewindPreview: reject("conversations.rewindPreview"),
  rewind: reject("conversations.rewind"),
  cancelQueued: reject("conversations.cancelQueued"),
  checkpoints: reject("conversations.checkpoints"),
  checkpointDiff: reject("conversations.checkpointDiff"),
};

export const workspaceStubs: Pick<Core, "workspaces" | "processes" | "mcp"> = {
  workspaces: {
    status: reject("workspaces.status"),
    merge: reject("workspaces.merge"),
    createPullRequest: reject("workspaces.createPullRequest"),
    remove: reject("workspaces.remove"),
  },
  processes: {
    list: reject("processes.list"),
    logs: reject("processes.logs"),
    stop: reject("processes.stop"),
  },
  mcp: {
    servers: reject("mcp.servers"),
    save: reject("mcp.save"),
    remove: reject("mcp.remove"),
  },
};
