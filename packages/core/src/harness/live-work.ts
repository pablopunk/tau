import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import type { Approvals } from "../approvals/approvals-port";
import type { ProcessService } from "../processes/process-service";
import { BACKGROUND } from "./open";
import { childrenOfThread } from "./subagent-own";

export interface LiveWork {
  /** True while a subagent child of the thread runs, or a process or monitor of the thread runs. */
  hasLiveWork(conversationId: string): Promise<boolean>;
}

export function createLiveWork(deps: {
  readonly harness: Harness;
  readonly processes: Pick<ProcessService, "hasRunning">;
  readonly approvals?: Pick<Approvals, "hasPending">;
}): LiveWork {
  const hasRunningChild = async (id: ConversationId) => {
    const children = await deps.harness.commit((tx) => childrenOfThread(tx, id), BACKGROUND);
    return children.some((child) => child.agentStatus === "running");
  };
  return {
    async hasLiveWork(conversationId) {
      if (deps.processes.hasRunning(conversationId)) return true;
      if (deps.approvals?.hasPending(conversationId)) return true;
      return hasRunningChild(Number(conversationId) as ConversationId).catch(() => false);
    },
  };
}
