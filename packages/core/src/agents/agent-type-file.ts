import { type ThinkingLevel, ThinkingLevelSchema } from "@tau/protocol";
import { Value } from "typebox/value";
import type { AgentType, AgentTypeSource } from "./agent-types";
import { listOf, parseFrontmatter, textOf } from "./frontmatter";
import { mapClaudeTools, mapDisallowedTools } from "./tool-mapping";

const NO_TOOLS_ERROR = "None of the listed tools map to a tool this app provides.";

function mapTools(requested: readonly string[] | undefined) {
  if (requested === undefined) return { tools: undefined, error: undefined };
  const tools = mapClaudeTools(requested);
  return { tools, error: tools.length === 0 ? NO_TOOLS_ERROR : undefined };
}

export function thinkingOf(value: string | undefined): ThinkingLevel | undefined {
  const word = value?.trim().toLowerCase();
  if (!word) return undefined;
  return Value.Check(ThinkingLevelSchema, word) ? (word as ThinkingLevel) : undefined;
}

export function parseAgentTypeFile(fileBase: string, content: string, source: AgentTypeSource): AgentType {
  const { fields, body } = parseFrontmatter(content);
  const { tools, error } = mapTools(listOf(fields.get("tools")));
  return {
    name: textOf(fields.get("name"))?.trim() || fileBase,
    description: textOf(fields.get("description")) ?? "",
    source,
    tools,
    disallowedTools: mapDisallowedTools(listOf(fields.get("disallowedTools")) ?? []),
    model: textOf(fields.get("model")),
    thinking: thinkingOf(textOf(fields.get("thinking")) ?? textOf(fields.get("effort"))),
    prompt: body,
    ...(error ? { error } : {}),
  };
}
