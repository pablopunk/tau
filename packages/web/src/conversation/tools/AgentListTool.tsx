import type { AgentStatus } from "@pi-everywhere/protocol";
import { List } from "lucide-react";
import { AgentStatusBadge } from "@/sidebar/subagents/AgentStatusBadge";
import { useModelLabel } from "@/sidebar/subagents/use-model-label";
import { resultDetails } from "../model/tool-state";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

interface ListedAgent {
  readonly id: string;
  readonly description: string;
  readonly type: string;
  readonly model: string;
  readonly status: AgentStatus | undefined;
}

const STATUSES: readonly string[] = ["running", "done", "failed", "stopped"];

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function toListed(raw: unknown): ListedAgent {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const status = text(row.status);
  return {
    id: text(row.id),
    description: text(row.description),
    type: text(row.type),
    model: text(row.model),
    status: STATUSES.includes(status) ? (status as AgentStatus) : undefined,
  };
}

export function listedAgents(state: ToolRendererProps["state"]): ListedAgent[] {
  const agents = resultDetails(state).agents;
  return Array.isArray(agents) ? agents.map(toListed) : [];
}

export function AgentListTool({ state }: ToolRendererProps) {
  const agents = listedAgents(state);
  const modelLabel = useModelLabel();
  return (
    <ToolCard icon={<List />} title="Subagents" subtitle={`${agents.length} total`} status={state.status}>
      {agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No subagents.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Description</th>
              <th className="py-1 pr-2 font-medium">Type</th>
              <th className="py-1 pr-2 font-medium">Model</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <td className="py-1 pr-2">{agent.description || agent.id}</td>
                <td className="py-1 pr-2">{agent.type}</td>
                <td className="py-1 pr-2">{modelLabel.ofKey(agent.model)}</td>
                <td className="py-1">
                  <AgentStatusBadge status={agent.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ToolCard>
  );
}
