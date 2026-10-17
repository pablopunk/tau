import type { Core } from "@pi-everywhere/protocol";
import type { ChangeEmitter } from "./change-emitter";
import type { SettingsStore } from "./home/settings-store";
import type { McpService } from "./mcp/mcp-service";

export function createMcpApi(deps: {
  settings: SettingsStore;
  mcp: McpService;
  changes: ChangeEmitter;
}): Core["mcp"] {
  const { settings, mcp, changes } = deps;
  const announce = () => changes.emit({ resource: "mcp" });
  return {
    servers: (projectId) => mcp.servers(projectId),
    async save(config) {
      await settings.saveMcpServer(config);
      await mcp.forget(config.name);
      announce();
    },
    async remove(name) {
      await settings.removeMcpServer(name);
      await mcp.forget(name);
      announce();
    },
  };
}
