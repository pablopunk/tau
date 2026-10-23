import {
  defineExtension,
  type Extension,
  type ToolExecutionApi,
  type ToolRegistration,
  wrapTool,
} from "@earendil-works/pi-durable";
import { type TObject, type TProperties, Type } from "typebox";
import type { NativeDelegation } from "../../runtimes/native/delegation";
import { NATIVE_EXECUTOR } from "../runtime-docs";

type CallContext = Parameters<ToolExecutionApi["commit"]>[1];

/** Delegation is offered only while the node says so; the tool reads it lazily because the service starts later. */
export interface NativeAgentGate {
  readonly delegation: () => NativeDelegation | undefined;
}

export const NATIVE_DELEGATION_FLAG = "TAU_EXPERIMENTAL_NATIVE_DELEGATION";

export const nativeDelegationFlagOn = (env: Readonly<Record<string, string | undefined>>): boolean =>
  env[NATIVE_DELEGATION_FLAG] === "1";

export const EXECUTOR_NOT_AVAILABLE =
  "executor is not available on this node: native delegation is not enabled. Omit executor.";

export const NATIVE_BACKGROUND_REFUSED =
  "background native children are not supported yet: with executor claude-code the call always waits. Omit run_in_background.";

export const NATIVE_OPTION_REFUSED = (names: readonly string[]) =>
  `${names.join(", ")} cannot be used with executor claude-code. Omit them.`;

const NATIVE_DESCRIPTION_LINES = [
  `- \`executor: "${NATIVE_EXECUTOR}"\` runs the subagent as a native Claude Code thread in this same folder instead of one of your own models. It always waits and returns the final report; \`run_in_background: true\`, \`subagent_type\`, \`model\`, \`thinking\` and \`isolation\` are refused with it.`,
  "- A native subagent cannot start subagents and cannot be messaged, stopped or merged with the subagent tools; stopping this call cancels it. If the result says the outcome is unknown, check the workspace and open the child thread before continuing.",
];

export const withNativeDescription = (description: string): string =>
  [description, ...NATIVE_DESCRIPTION_LINES].join("\n");

export function withExecutorParameter<T extends TProperties>(base: TObject<T>) {
  return Type.Object({
    ...base.properties,
    executor: Type.Optional(Type.Literal(NATIVE_EXECUTOR)),
  });
}

type NativeArgs = {
  readonly description: string;
  readonly prompt: string;
  readonly subagent_type?: string | undefined;
  readonly model?: unknown;
  readonly thinking?: unknown;
  readonly isolation?: unknown;
  readonly run_in_background?: boolean | undefined;
  readonly executor?: unknown;
};

export const hasExecutor = (args: object): boolean => (args as NativeArgs).executor !== undefined;

const UNSUPPORTED_WITH_NATIVE = ["subagent_type", "model", "thinking", "isolation"] as const;

/** Refuses before any side effect. */
export function assertNativeCallAllowed(args: NativeArgs): void {
  if (args.executor !== NATIVE_EXECUTOR) throw new Error(EXECUTOR_NOT_AVAILABLE);
  if (args.run_in_background === true) throw new Error(NATIVE_BACKGROUND_REFUSED);
  const given = UNSUPPORTED_WITH_NATIVE.filter((name) => args[name] !== undefined);
  if (given.length > 0) throw new Error(NATIVE_OPTION_REFUSED(given));
}

export const startedNativeMessage = (childId: string) =>
  `Delegated to native Claude child thread ${childId}. If this call is interrupted before it returns, open that thread to see what happened.\n`;

export async function executeNative(
  args: NativeArgs,
  api: ToolExecutionApi,
  context: CallContext,
  delegation: NativeDelegation | undefined,
) {
  if (!delegation) throw new Error(EXECUTOR_NOT_AVAILABLE);
  assertNativeCallAllowed(args);
  if (context.abortSignal?.aborted) throw new Error("This call was stopped before the child started.");
  const result = await delegation.runNativeChild({
    parentId: String(api.conversationId),
    callId: api.callId,
    description: args.description,
    prompt: args.prompt,
    signal: context.abortSignal,
    onStarted: async (childId) => {
      api.output(startedNativeMessage(childId));
      await api.details({ conversationId: childId, status: "running" }, context);
    },
  });
  const details = { conversationId: result.childId, status: result.status };
  if (!result.ok) {
    await api.details(details, context);
    throw new Error(result.message);
  }
  return { output: [{ type: "text" as const, text: result.text }], details };
}

export const nativeChildRefusal = (tool: string, id: string) =>
  `Subagent ${id} is a native Claude child: ${tool} does not apply to it. It is awaited by the call that started it; stop that call to cancel it.`;

const GUARDED_TOOLS: ReadonlyArray<{ readonly name: string; readonly field: string }> = [
  { name: "send_message", field: "to" },
  { name: "stop_agent", field: "id" },
  { name: "merge_agent", field: "id" },
];

const placeholderFor = (name: string) => ({ name }) as unknown as ToolRegistration;

/** Subagent tools that would hand a native child to Pi (a model run, a merge of the parent's folder) refuse it first. */
export function nativeChildGuard(delegation: () => NativeDelegation | undefined): Extension {
  const wrapped = GUARDED_TOOLS.map(({ name, field }) =>
    wrapTool(placeholderFor(name), (tool) => ({
      ...tool,
      execute: async (args, api, context) => {
        const target = (args as Record<string, unknown>)[field];
        if (typeof target === "string" && (await delegation()?.isNativeChild(target))) {
          throw new Error(nativeChildRefusal(name, target));
        }
        return tool.execute(args, api, context);
      },
    })),
  );
  return defineExtension({ name: "native-child-guard", wraps: wrapped as never });
}
