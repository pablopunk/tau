import type { McpServerConfig, McpServerStatus } from "@tau/protocol";
import { findServer, mergeServers, readProjectServers, type SourcedServer } from "./mcp-config";
import { type McpConnection, openMcpConnection } from "./mcp-connection";
import { createMcpPool, type McpPool } from "./mcp-pool";
import { matchesQuery } from "./mcp-tool-match";

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
  readonly emitChange?: () => void;
  readonly idleMs?: number;
  readonly open?: (config: McpServerConfig, cwd: string) => Promise<McpConnection>;
}

const SETTINGS_CWD = process.cwd();

const poolKeyOf = (server: SourcedServer, projectPath: string | null) =>
  server.source === "project"
    ? `project:${projectPath}:${server.config.name}`
    : `settings:${server.config.name}`;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createMcpService(deps: McpDeps): McpService {
  const open = deps.open ?? openMcpConnection;
  const pool: McpPool = createMcpPool({ idleMs: deps.idleMs, onChange: deps.emitChange });

  async function serversFor(projectId: string | null) {
    const projectPath = projectId === null ? null : await deps.projectPathOf(projectId);
    const project = projectPath === null ? [] : await readProjectServers(projectPath);
    return { projectPath, servers: mergeServers(await deps.settingsServers(), project) };
  }

  const connect = (server: SourcedServer, projectPath: string | null) =>
    pool.acquire(poolKeyOf(server, projectPath), server.config.name, () =>
      open(server.config, projectPath ?? SETTINGS_CWD),
    );

  async function listTools(server: SourcedServer, projectPath: string | null): Promise<McpToolInfo[]> {
    const connection = await connect(server, projectPath);
    const { tools } = await connection.client.listTools();
    pool.setToolCount(poolKeyOf(server, projectPath), tools.length);
    return tools.map((tool) => ({
      server: server.config.name,
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
    }));
  }

  const statusOf = (server: SourcedServer, projectPath: string | null): McpServerStatus => ({
    name: server.config.name,
    source: server.source,
    transport: "command" in server.config ? "stdio" : "http",
    ...pool.status(poolKeyOf(server, projectPath)),
  });

  return {
    async servers(projectId) {
      const { projectPath, servers } = await serversFor(projectId);
      return servers.map((server) => statusOf(server, projectPath));
    },
    async search(projectId, query) {
      const { projectPath, servers } = await serversFor(projectId);
      const settled = await Promise.allSettled(servers.map((server) => listTools(server, projectPath)));
      const tools = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
      const failures = settled.flatMap((result, index) =>
        result.status === "rejected" ? [`${servers[index]?.config.name}: ${messageOf(result.reason)}`] : [],
      );
      if (tools.length === 0 && failures.length > 0) {
        throw new Error(`No MCP server is reachable. ${failures.join("; ")}`);
      }
      return tools.filter((tool) => matchesQuery(tool, query));
    },
    async call(projectId, serverName, tool, args) {
      const { projectPath, servers } = await serversFor(projectId);
      const server = findServer(servers, serverName);
      if (!server) throw new Error(`No MCP server named "${serverName}". Use mcp_search to see the servers.`);
      const connection = await connect(server, projectPath);
      return connection.client.callTool({ name: tool, arguments: args });
    },
    forget: (name) => pool.forget(name),
    closeAll: () => pool.closeAll(),
  };
}
