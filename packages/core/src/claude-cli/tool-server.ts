import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ClaudeToolHost } from "./sdk-types";

export const TOOL_SERVER_NAME = "tau";
export const TOOL_NAME_PREFIX = `mcp__${TOOL_SERVER_NAME}__`;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TOOL_USE_ID_META = "claudecode/toolUseId";

interface LowLevelServer {
  registerCapabilities(capabilities: Record<string, unknown>): void;
  setRequestHandler(schema: unknown, handler: (request: ToolRequest) => Promise<unknown>): void;
  sendToolListChanged(): Promise<void>;
}

interface ToolRequest {
  readonly params: {
    readonly name: string;
    readonly arguments?: Record<string, unknown>;
    readonly _meta?: Record<string, unknown>;
  };
}

export interface SdkMcpServerConfig {
  readonly instance: { readonly server: LowLevelServer };
}

export type CreateSdkMcpServer = (options: Record<string, unknown>) => SdkMcpServerConfig;

export interface ToolServer {
  readonly config: SdkMcpServerConfig & { readonly timeout: number; readonly alwaysLoad: boolean };
  readonly dispose: () => void;
}

const toolUseIdOf = (request: ToolRequest): string => {
  const id = request.params._meta?.[TOOL_USE_ID_META];
  return typeof id === "string" ? id : `unknown-${request.params.name}`;
};

export function buildToolServer(createSdkMcpServer: CreateSdkMcpServer, host: ClaudeToolHost): ToolServer {
  const config = createSdkMcpServer({ name: TOOL_SERVER_NAME, version: "0.0.1", tools: [] });
  const server = config.instance.server;
  server.registerCapabilities({ tools: { listChanged: true } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: host.listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await host.callTool({
      name: request.params.name,
      arguments: request.params.arguments ?? {},
      toolUseId: toolUseIdOf(request),
    });
    return { content: result.content, isError: result.isError };
  });
  const dispose = host.onToolsChanged(() => void server.sendToolListChanged().catch(() => undefined));
  return { config: { ...config, timeout: ONE_DAY_MS, alwaysLoad: true }, dispose };
}
