import type { Change } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { type InvalidationStep, invalidationsFor } from "./invalidation-scope";
import { queryKeys } from "./queries";

const cases: Array<[string, Change, readonly InvalidationStep[]]> = [
  [
    "projects",
    { resource: "projects" },
    [{ queryKey: queryKeys.projects }, { queryKey: ["conversations"] }, { queryKey: queryKeys.githubRepos }],
  ],
  [
    "providers",
    { resource: "providers" },
    [{ queryKey: queryKeys.providers }, { queryKey: queryKeys.models }],
  ],
  [
    "conversations",
    { resource: "conversations", projectId: "p1" },
    [
      { queryKey: queryKeys.conversations("p1") },
      { queryKey: queryKeys.allConversations },
      { queryKey: ["workspace"], refetchType: "active" },
      { queryKey: ["checkpoints"], refetchType: "active" },
      { queryKey: ["goal"], refetchType: "active" },
    ],
  ],
  [
    "processes",
    { resource: "processes", conversationId: "c1" },
    [{ queryKey: queryKeys.processes("c1") }, { queryKey: ["process-logs"] }],
  ],
  ["terminals", { resource: "terminals", conversationId: "c1" }, []],
  ["timers", { resource: "timers", conversationId: "c1" }, [{ queryKey: queryKeys.timers("c1") }]],
  ["mcp", { resource: "mcp" }, [{ queryKey: queryKeys.allMcpServers }]],
  ["approvals", { resource: "approvals", conversationId: "c1" }, [{ queryKey: queryKeys.approvals("c1") }]],
  [
    "remote",
    { resource: "remote" },
    [{ queryKey: queryKeys.remoteStatus }, { queryKey: queryKeys.settings }],
  ],
  ["devices", { resource: "devices" }, [{ queryKey: queryKeys.devices }]],
  ["nodes", { resource: "nodes" }, [{ queryKey: queryKeys.nodes }]],
  ["resources", { resource: "resources" }, [{ queryKey: queryKeys.resourceActivity }]],
];

describe("invalidationsFor", () => {
  it.each(cases)("preserves the %s resource invalidation scope", (_resource, change, expected) => {
    expect(invalidationsFor(change)).toEqual(expected);
  });
});
