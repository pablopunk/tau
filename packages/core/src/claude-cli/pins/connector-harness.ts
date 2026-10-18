import { createClaudeInput } from "../claude-input";
import type {
  ClaudeCanUseTool,
  ClaudeMcpControl,
  ClaudeMcpServerStatus,
  ClaudePermissionRequest,
  ClaudeQuery,
  ClaudeSdkMessage,
} from "../sdk-types";
import { type PinContext, pinOptions } from "./pin-context";
import {
  createPinHost,
  isInit,
  type PinHost,
  type Recorder,
  record,
  sleep,
  textOf,
  toolUsesOf,
} from "./pin-harness";

export const MAX_CONNECTOR_PIN_TURNS = 8;
export const LINEAR_SERVER = "claude.ai Linear";
export const LINEAR_PREFIX = "mcp__claude_ai_Linear__";
export const TURN_TIMEOUT_MS = 120_000;
const CONNECTOR_WAIT_MS = 30_000;
const POLL_MS = 250;

export const isConnected = (server: ClaudeMcpServerStatus) => server.status === "connected";

export async function waitForConnectors(
  control: ClaudeMcpControl,
  timeoutMs = CONNECTOR_WAIT_MS,
): Promise<{ servers: readonly ClaudeMcpServerStatus[]; waitedMs: number }> {
  const startedAt = Date.now();
  while (true) {
    const servers = await control.mcpServerStatus();
    const hasConnectors = servers.some((server) => server.source !== "sdk");
    const settled = hasConnectors && !servers.some((server) => server.status === "pending");
    if (settled || Date.now() - startedAt > timeoutMs) return { servers, waitedMs: Date.now() - startedAt };
    await sleep(POLL_MS);
  }
}

export async function switchOffAllBut(control: ClaudeMcpControl, keep: string): Promise<string[]> {
  const { servers } = await waitForConnectors(control);
  const others = servers.filter(
    (server) => server.name !== keep && server.source !== "sdk" && server.status !== "disabled",
  );
  for (const server of others) await control.toggleMcpServer(server.name, false).catch(() => undefined);
  return others.map((server) => server.name);
}

async function requireServersReady(control: ClaudeMcpControl, needsTau: boolean): Promise<void> {
  const servers = await control.mcpServerStatus();
  const connected = (name: string) => servers.some((server) => server.name === name && isConnected(server));
  if (!connected(LINEAR_SERVER)) throw new Error("Linear is not connected after the toggles");
  if (needsTau && !connected("tau")) throw new Error("the tau server is not connected after the toggles");
}

export async function switchOn(control: ClaudeMcpControl, names: readonly string[]): Promise<void> {
  for (const name of names) await control.toggleMcpServer(name, true).catch(() => undefined);
}

export interface PermissionLog {
  readonly requests: (ClaudePermissionRequest & { readonly at: number })[];
  readonly aborted: () => boolean;
}

export function loggingPermission(decide: ClaudeCanUseTool): {
  canUseTool: ClaudeCanUseTool;
  log: PermissionLog;
} {
  const requests: PermissionLog["requests"] = [];
  let aborted = false;
  return {
    log: { requests, aborted: () => aborted },
    canUseTool: async (request) => {
      requests.push({ ...request, at: Date.now() });
      request.signal.addEventListener("abort", () => {
        aborted = true;
      });
      return decide(request);
    },
  };
}

export interface ToolResultBlock {
  readonly id: string;
  readonly isError: boolean;
  readonly text: string;
}

export function toolResultsOf(message: ClaudeSdkMessage): ToolResultBlock[] {
  if (message.type !== "user") return [];
  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap(
    (block: { type?: string; tool_use_id?: string; is_error?: boolean; content?: unknown }) =>
      block.type === "tool_result" && block.tool_use_id
        ? [
            {
              id: block.tool_use_id,
              isError: block.is_error === true,
              text: JSON.stringify(block.content ?? ""),
            },
          ]
        : [],
  );
}

export const allToolResults = (recorder: Recorder) =>
  recorder.messages.flatMap(({ at, message }) => toolResultsOf(message).map((result) => ({ ...result, at })));

export interface ConnectorSession {
  readonly query: ClaudeQuery;
  readonly recorder: Recorder;
  readonly host: PinHost;
  ask(prompt: string): void;
  /** Switches the servers back on first: a toggle may outlive the query. */
  close(): Promise<void>;
}

export interface SessionSetup {
  readonly canUseTool: ClaudeCanUseTool;
  readonly allowedTools: readonly string[];
  readonly host?: PinHost;
}

export async function startConnectorSession(ctx: PinContext, setup: SessionSetup): Promise<ConnectorSession> {
  const host = setup.host ?? createPinHost([]);
  const input = createClaudeInput();
  const query = ctx.port.startQuery(
    pinOptions(ctx.cwd, input.stream, host, {
      strictMcpConfig: false,
      settings: { disableClaudeAiConnectors: false, autoCompactEnabled: false },
      permissionMode: "default",
      allowedTools: setup.allowedTools,
      canUseTool: setup.canUseTool,
    }),
  );
  const recorder = record(query);
  const switchedOff = await switchOffAllBut(query, LINEAR_SERVER);
  await requireServersReady(query, setup.host !== undefined);
  return {
    query,
    recorder,
    host,
    ask(prompt) {
      ctx.budget.spend(prompt.slice(0, 60));
      input.push(prompt);
    },
    async close() {
      await switchOn(query, switchedOff);
      input.close();
      query.close();
    },
  };
}

export const initOf = (recorder: Recorder): ClaudeSdkMessage | undefined =>
  recorder.messages.map((entry) => entry.message).find(isInit);

export function transcriptSummary(recorder: Recorder): string {
  const lines = recorder.messages.map(({ message }) => {
    const uses = toolUsesOf(message).map((use) => use.name);
    const results = toolResultsOf(message).map(
      (row) => `${row.isError ? "ERR" : "ok"}:${row.text.slice(0, 120)}`,
    );
    const text = message.type === "assistant" ? textOf(message).slice(0, 120) : "";
    const tail = [...uses, ...results, text].filter(Boolean).join(" ");
    return `${message.type}/${String(message.subtype ?? "")} ${tail}`.trim();
  });
  return lines
    .filter((line) => !line.startsWith("stream_event"))
    .slice(-14)
    .join(" || ");
}
