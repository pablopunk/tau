import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";
import { AppError, type ModelRef, type ThinkingLevel } from "@tau/protocol";
import { type AgentType, GENERAL_PURPOSE } from "../../agents/agent-types";
import type { SubagentServices } from "../subagent-services";
import { isSubagentTool } from "../subagent-tool-names";
import { FORK_INSTRUCTIONS } from "./fork-instructions";

export const FORK = "fork";

export type ChildPlan = {
  readonly type: string;
  readonly model: ModelRef;
  readonly thinkingLevel: ThinkingLevel;
  readonly tools: readonly ToolRegistration[];
  readonly instructions: string | undefined;
};

type ParentAgent = Awaited<ReturnType<ToolExecutionApi["agent"]>>;

export type PlanInput = {
  readonly subagentType: string | undefined;
  readonly model: string | undefined;
  readonly thinking?: ThinkingLevel | undefined;
  readonly parent: ParentAgent;
  readonly projectPath: string;
  readonly connected: readonly ModelRef[];
  readonly services: SubagentServices;
};

const isInherit = (requested: string | undefined) =>
  requested === undefined || ["", "inherit"].includes(requested.trim().toLowerCase());

export const unknownTypeMessage = (name: string, known: readonly AgentType[]) =>
  `Unknown subagent_type "${name}". Available: ${[FORK, ...known.map((type) => type.name)].join(", ")}.`;

async function typeNamed(name: string, input: PlanInput): Promise<AgentType> {
  const known = await input.services.agentTypes.load(input.projectPath);
  const found = known.find((type) => type.name === name);
  if (!found) throw new Error(unknownTypeMessage(name, known));
  if (found.error !== undefined) throw new Error(`Agent type "${name}" cannot be used: ${found.error}`);
  return found;
}

const isDefaultType = (name: string | undefined) => name === undefined || name === GENERAL_PURPOSE;

function allowedTools(all: readonly ToolRegistration[], type: AgentType | undefined) {
  const withoutSubagentTools = all.filter((tool) => !isSubagentTool(tool.name));
  if (!type) return withoutSubagentTools;
  const allowed = (tool: ToolRegistration) =>
    (type.tools === undefined || type.tools.includes(tool.name)) && !type.disallowedTools.includes(tool.name);
  return withoutSubagentTools.filter(allowed);
}

async function resolveModel(requested: string | undefined, input: PlanInput): Promise<ModelRef> {
  const parent = input.parent.model;
  if (!parent) throw new Error("This thread has no model to inherit.");
  if (isInherit(requested)) return parent;
  const fast = await input.services.fastModel();
  return input.services.resolveModelAlias(requested, { parent, fast, connected: input.connected });
}

async function resolveTypeModel(requested: string | undefined, input: PlanInput): Promise<ModelRef> {
  try {
    return await resolveModel(requested, input);
  } catch (error) {
    if (!(error instanceof AppError) || !input.parent.model) throw error;
    return input.parent.model;
  }
}

const resolveChildModel = (type: AgentType | undefined, input: PlanInput) =>
  input.model === undefined ? resolveTypeModel(type?.model, input) : resolveModel(input.model, input);

const FALLBACK_LEVEL: ThinkingLevel = "medium";

/** Order: the tool argument, then the agent type, then the parent's level; clamped to the child's model. */
function resolveThinking(model: ModelRef, type: AgentType | undefined, input: PlanInput): ThinkingLevel {
  const wanted = input.thinking ?? type?.thinking ?? input.parent.thinkingLevel ?? FALLBACK_LEVEL;
  return input.services.clampThinking(model, wanted);
}

export async function planChild(input: PlanInput): Promise<ChildPlan> {
  const fork = input.subagentType === FORK;
  const type =
    fork || isDefaultType(input.subagentType) ? undefined : await typeNamed(input.subagentType!, input);
  const model = await resolveChildModel(type, input);
  return {
    type: fork ? FORK : (type?.name ?? GENERAL_PURPOSE),
    model,
    thinkingLevel: resolveThinking(model, type, input),
    tools: allowedTools(input.parent.tools, type),
    instructions: fork ? FORK_INSTRUCTIONS : type?.prompt || undefined,
  };
}
