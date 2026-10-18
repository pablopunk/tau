import { tmpdir } from "node:os";
import { createClaudeInput } from "../claude-input";
import type { ClaudeContentBlock, ClaudeSdkPort, ClaudeToolHost } from "../sdk-types";
import type { Binding } from "./binding";
import { type CallContext, headOf } from "./call-context";
import { pump } from "./pump";
import { buildQueryOptions } from "./query-options";
import type { Runtime } from "./runtime";

export interface Launch {
  readonly content: string | readonly ClaudeContentBlock[];
  readonly resume?: string;
  readonly resumeSessionAt?: string;
  readonly forkSession?: boolean;
  /** A plain resume keeps its session, so its checkpoints stay valid. */
  readonly keepCheckpoints: boolean;
}

export const hostOf = (binding: Binding): ClaudeToolHost => ({
  listTools: () =>
    binding.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as Record<string, unknown>,
    })),
  callTool: (call) => binding.calls.wait(call.toolUseId),
  onToolsChanged: () => () => undefined,
});

export const titleOf = (binding: Binding): string => `tau · ${binding.id.slice(0, 8)}`;

function retireSession(port: ClaudeSdkPort, binding: Binding, previous: string | null, current: string) {
  if (previous === null || previous === current || !binding.created.has(previous)) return;
  binding.created.delete(previous);
  void port.deleteSession(previous).catch(() => undefined);
}

function commitOnFirstMessage(port: ClaudeSdkPort, binding: Binding, call: CallContext, launch: Launch) {
  const previous = binding.sdkSessionId;
  binding.onFirstMessage = (sessionId) => {
    binding.sdkSessionId = sessionId;
    binding.created.add(sessionId);
    binding.head = headOf(call);
    if (!launch.keepCheckpoints) binding.checkpoints = [];
    retireSession(port, binding, previous, sessionId);
  };
}

/** Starts an SDK query with the content as its first user message. */
export async function launchQuery(
  rt: Runtime,
  binding: Binding,
  call: CallContext,
  launch: Launch,
): Promise<void> {
  const port = await rt.port();
  if (binding.listener?.isSettled()) return;
  const input = createClaudeInput();
  input.push(launch.content);
  binding.tools = call.tools;
  binding.model = call.modelValue;
  binding.effort = call.effort;
  binding.input = input;
  binding.owedResults = 0;
  binding.expected.clear();
  commitOnFirstMessage(port, binding, call, launch);
  const query = port.startQuery(
    buildQueryOptions({
      prompt: input.stream,
      model: call.modelValue,
      cwd: tmpdir(),
      systemPrompt: call.systemPrompt,
      env: rt.deps.env,
      title: titleOf(binding),
      effort: call.effort,
      resume: launch.resume,
      resumeSessionAt: launch.resumeSessionAt,
      forkSession: launch.forkSession,
      toolHost: hostOf(binding),
    }),
  );
  binding.query = query;
  rt.live.add(binding);
  rt.notifyProcesses();
  pump(rt, binding, query);
}
