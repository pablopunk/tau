import type { McpServerConfig, McpServerStatus } from "@pi-everywhere/protocol";
import { notImplemented } from "../not-implemented";

export interface McpToolInfo {
  readonly server: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

export interface McpService {
  /** Settings servers plus the project's `.mcp.json`; never returns env or header values. */
  servers(projectId: string | null): Promise<McpServerStatus[]>;
  /** Matching tools across the project's servers, connecting lazily. Server failures come back as tool errors. */
  search(projectId: string, query: string): Promise<McpToolInfo[]>;
  call(projectId: string, server: string, tool: string, args: Record<string, unknown>): Promise<unknown>;
  /** A server was saved or removed in Settings: drop its pooled connection. */
  forget(name: string): Promise<void>;
  closeAll(): Promise<void>;
}

export interface McpDeps {
  readonly settingsServers: () => Promise<McpServerConfig[]>;
  readonly projectPathOf: (projectId: string) => Promise<string>;
}

const statusOf = (config: McpServerConfig): McpServerStatus => ({
  name: config.name,
  source: "settings",
  transport: "command" in config ? "stdio" : "http",
  state: "idle",
  toolCount: null,
  error: null,
});

export function createMcpService(deps: McpDeps): McpService {
  return {
    servers: async () => (await deps.settingsServers()).map(statusOf),
    search: async () => {
      throw notImplemented("mcp.search");
    },
    call: async () => {
      throw notImplemented("mcp.call");
    },
    forget: async () => undefined,
    closeAll: async () => undefined,
  };
}
