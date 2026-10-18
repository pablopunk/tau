import { tmpdir } from "node:os";
import { createClaudeInput } from "../claude-input";
import type { ClaudeContentBlock, ClaudeQuery, ClaudeSdkPort, ClaudeToolHost } from "../sdk-types";
import type { Binding } from "./binding";
import { type CallContext, headOf } from "./call-context";
import { type ConnectorChoice, chooseConnectors, NO_CONNECTORS, optionsKeyOf } from "./connector-choice";
import { connectorSettingsOf } from "./connector-settings";
import { readConnectorStatus } from "./connector-status";
import { closeQuery, pushInput } from "./lifecycle";
import { createCanUseTool } from "./permissions";
import { pump } from "./pump";
import { buildQueryOptions, type ConnectorQueryInput } from "./query-options";
import type { Runtime } from "./runtime";
import { lateConnectorNotes, waitForConnectors } from "./wait-connectors";

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

interface ConnectorSetup {
  readonly key: string;
  readonly choice: ConnectorChoice;
}

async function setupConnectors(rt: Runtime, port: ClaudeSdkPort): Promise<ConnectorSetup> {
  const settings = await connectorSettingsOf(rt);
  const key = optionsKeyOf(settings);
  if (!settings || settings.enabled.length === 0) return { key, choice: NO_CONNECTORS };
  return { key, choice: chooseConnectors(settings, await readConnectorStatus(rt, port)) };
}

const connectorQueryInput = (
  rt: Runtime,
  binding: Binding,
  choice: ConnectorChoice,
): ConnectorQueryInput => ({
  allowedTools: choice.allowedTools,
  disallowedTools: choice.disallowedTools,
  canUseTool: createCanUseTool(rt, binding, choice.names, choice.askBeforeWrites),
});

/** Connectors load a few seconds after the process starts; the first input waits for them. */
async function waitForChosenConnectors(rt: Runtime, query: ClaudeQuery, choice: ConnectorChoice) {
  const statuses = await waitForConnectors(rt.deps.clock, query);
  const late = lateConnectorNotes(choice.names, statuses);
  if (late.length > 0) rt.deps.onConnectorsLate?.(late);
}

async function sendFirstInput(
  rt: Runtime,
  binding: Binding,
  query: ClaudeQuery,
  choice: ConnectorChoice,
  content: Launch["content"],
): Promise<void> {
  if (choice.names.length > 0) await waitForChosenConnectors(rt, query, choice);
  if (binding.query !== query) return;
  if (binding.listener?.isSettled()) return closeQuery(rt, binding);
  pushInput(binding, content);
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
  const { key, choice } = await setupConnectors(rt, port);
  if (binding.listener?.isSettled()) return;
  const input = createClaudeInput();
  binding.tools = call.tools;
  binding.model = call.modelValue;
  binding.reasoning = call.reasoning;
  binding.input = input;
  binding.owedResults = 0;
  binding.resultSeen = false;
  binding.cliBusy = false;
  binding.optionsKey = key;
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
      reasoning: call.reasoning,
      resume: launch.resume,
      resumeSessionAt: launch.resumeSessionAt,
      forkSession: launch.forkSession,
      toolHost: hostOf(binding),
      connectors: choice.names.length > 0 ? connectorQueryInput(rt, binding, choice) : undefined,
    }),
  );
  binding.query = query;
  rt.live.add(binding);
  rt.notifyProcesses();
  pump(rt, binding, query);
  await sendFirstInput(rt, binding, query, choice, launch.content);
}
