import type { Change, Core, McpServerConfig, McpServerStatus } from "@tau/protocol";

function statusOf(config: McpServerConfig): McpServerStatus {
  return {
    name: config.name,
    source: "settings",
    transport: "command" in config ? "stdio" : "http",
    state: "idle",
    toolCount: null,
    error: null,
  };
}

function copyOf(config: McpServerConfig): McpServerConfig {
  return "command" in config
    ? { ...config, args: [...config.args], env: { ...config.env } }
    : { ...config, headers: { ...config.headers } };
}

export function createFakeMcp(deps: {
  emit: (change: Change) => void;
  requireProject: (id: string) => unknown;
}): Core["mcp"] {
  const servers = new Map<string, McpServerConfig>();
  return {
    async servers(projectId) {
      if (projectId !== null) deps.requireProject(projectId);
      return [...servers.values()].map(statusOf);
    },
    async save(config) {
      servers.set(config.name, copyOf(config));
      deps.emit({ resource: "mcp" });
    },
    async remove(name) {
      if (servers.delete(name)) deps.emit({ resource: "mcp" });
    },
  };
}
