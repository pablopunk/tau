import type { QueryKey } from "@tanstack/react-query";
import type { Change } from "@tau/protocol";
import { queryKeys } from "./queries";

export type InvalidationStep = {
  queryKey: QueryKey;
  refetchType?: "active" | "inactive" | "all" | "none";
};

export function invalidationsFor(change: Change): readonly InvalidationStep[] {
  switch (change.resource) {
    case "projects":
      return [
        { queryKey: queryKeys.projects },
        { queryKey: ["conversations"] },
        { queryKey: queryKeys.githubRepos },
      ];
    case "providers":
      return [{ queryKey: queryKeys.providers }, { queryKey: queryKeys.models }];
    case "conversations":
      return [
        { queryKey: queryKeys.conversations(change.projectId) },
        { queryKey: queryKeys.allConversations },
        { queryKey: ["workspace"] },
        { queryKey: ["checkpoints"] },
        { queryKey: ["goal"] },
      ];
    case "processes":
      return [{ queryKey: queryKeys.processes(change.conversationId) }, { queryKey: ["process-logs"] }];
    case "terminals":
      return [];
    case "timers":
      return [{ queryKey: queryKeys.timers(change.conversationId) }];
    case "mcp":
      return [{ queryKey: queryKeys.allMcpServers }];
    case "approvals":
      return [{ queryKey: queryKeys.approvals(change.conversationId) }];
    case "remote":
      return [{ queryKey: queryKeys.remoteStatus }, { queryKey: queryKeys.settings }];
    case "devices":
      return [{ queryKey: queryKeys.devices }];
    case "nodes":
      return [{ queryKey: queryKeys.nodes }];
    case "resources":
      return [{ queryKey: queryKeys.resourceActivity }];
  }
}
