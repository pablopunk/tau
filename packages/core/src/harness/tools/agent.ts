import {
  defineExtension,
  defineTool,
  type PromptInput,
  section,
  type ToolExecutionApi,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { ThinkingLevelSchema } from "@tau/protocol";
import { type Static, Type } from "typebox";
import { CONNECTOR_TOOL_REFERENCE, type ModelToolsChange } from "../connector-offering";
import { type ChildSpec, startBackgroundChild, startForkedBackgroundChild } from "../subagent-runtime";
import { subagentServicesOf } from "../subagent-services";
import { AGENT_DESCRIPTION } from "./agent-description";
import { createIsolatedWorkspace } from "./agent-isolation";
import { modelsGuidance } from "./agent-models";
import {
  EXECUTOR_NOT_AVAILABLE,
  executeNative,
  hasExecutor,
  type NativeAgentGate,
  withExecutorParameter,
  withNativeDescription,
} from "./agent-native";
import { FORK, planChild } from "./agent-plan";
import { runAndWait } from "./agent-wait";
import { projectIdOfCall } from "./mcp-project";
import type { ToolFileFactory, ToolServicesRef } from "./tool-file";

export const AgentParameters = Type.Object({
  description: Type.String(),
  prompt: Type.String(),
  subagent_type: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(ThinkingLevelSchema),
  isolation: Type.Optional(Type.Literal("worktree")),
  run_in_background: Type.Optional(Type.Boolean()),
});

type Args = Static<typeof AgentParameters>;
type CallContext = Parameters<ToolExecutionApi["commit"]>[1];

export const startedMessage = (id: string, description: string) =>
  `Started subagent ${id} (${description}). You will get a notification when it answers. Do not poll.`;

const withConnectorTool = (tools: readonly ToolRegistration[], offered: ModelToolsChange | undefined) =>
  offered?.modelTools ? [...tools, CONNECTOR_TOOL_REFERENCE] : tools;

async function specFor(args: Args, api: ToolExecutionApi, context: CallContext, ref: ToolServicesRef) {
  const services = subagentServicesOf(ref);
  const project = await services.projectOf(await projectIdOfCall(api, context));
  const plan = await planChild({
    subagentType: args.subagent_type,
    model: args.model,
    thinking: args.thinking,
    parent: await api.agent(context),
    projectPath: project.path,
    connected: await ref.current().connectedModels(),
    services,
  });
  const workspace =
    args.isolation === "worktree"
      ? await createIsolatedWorkspace(services, project, api.callId, args.description)
      : undefined;
  const offered = await services.connectorOffering?.modelToolsFor(plan.model);
  const spec: ChildSpec = {
    description: args.description,
    prompt: args.prompt,
    agent: {
      type: plan.type,
      model: plan.model,
      thinking: plan.thinkingLevel,
      background: args.run_in_background !== false,
    },
    thinkingLevel: plan.thinkingLevel,
    tools: plan.tools && withConnectorTool(plan.tools, offered),
    ...(offered && { modelTools: offered.modelTools }),
    foreground: args.run_in_background === false,
    ...(plan.instructions && { instructions: plan.instructions }),
    ...(workspace && { workspace }),
  };
  return spec;
}

async function execute(args: Args, api: ToolExecutionApi, context: CallContext, ref: ToolServicesRef) {
  const spec = await specFor(args, api, context, ref);
  const start = args.subagent_type === FORK ? startForkedBackgroundChild : startBackgroundChild;
  const childId = await start(api, context, spec);
  const conversationId = String(childId);
  if (args.run_in_background !== false) {
    const text = startedMessage(conversationId, args.description);
    return { output: [{ type: "text" as const, text }], details: { conversationId, status: "running" } };
  }
  await api.details({ conversationId, status: "running" }, context);
  const { status, report } = await runAndWait(api, context, childId, args.prompt);
  return { output: [{ type: "text" as const, text: report }], details: { conversationId, status } };
}

const hasAgentTool = (input: PromptInput) => input.agent.tools.some((tool) => tool.name === "agent");

async function modelsSection(ref: ToolServicesRef, input: PromptInput) {
  if (!hasAgentTool(input)) return undefined;
  const { connectedModels, subagents } = ref.current();
  return modelsGuidance(await connectedModels(), input.agent.model, await subagents.fastModel());
}

const AgentWithExecutorParameters = withExecutorParameter(AgentParameters);

const guardedExecute =
  (ref: ToolServicesRef, native: NativeAgentGate | undefined) =>
  (args: Args, api: ToolExecutionApi, context: CallContext) => {
    if (!hasExecutor(args)) return execute(args, api, context, ref);
    if (!native) throw new Error(EXECUTOR_NOT_AVAILABLE);
    return executeNative(args, api, context, native.delegation());
  };

/** Without `native` the registered tool is exactly the Pi-only one, and a call carrying `executor` is refused. */
export const buildAgentToolFile =
  (native?: NativeAgentGate): ToolFileFactory =>
  (services) => ({
    implemented: true,
    extension: defineExtension({
      name: "agent",
      sections: [section("subagent-models", (input) => modelsSection(services, input))],
      tools: [
        defineTool({
          name: "agent",
          description: native ? withNativeDescription(AGENT_DESCRIPTION) : AGENT_DESCRIPTION,
          parameters: (native ? AgentWithExecutorParameters : AgentParameters) as typeof AgentParameters,
          replay: "unsafe",
          executionMode: "parallel",
          execute: guardedExecute(services, native),
        }),
      ],
    }),
  });

export const agentToolFile: ToolFileFactory = buildAgentToolFile();
