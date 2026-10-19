import { useMemo } from "react";
import { useMcpServers, useModels, useProjects, useProviders } from "@/lib/queries";
import { dynamicEntries, SETTINGS_INDEX, type SettingEntry } from "./settings-index";

/** The fixed index plus one entry per provider, project, MCP server and model, all for this node. */
export function useSettingEntries({ withModels = true } = {}): SettingEntry[] {
  const providers = useProviders().data;
  const projects = useProjects().data;
  const models = useModels().data;
  const mcpServers = useMcpServers(null).data;
  return useMemo(
    () => [
      ...SETTINGS_INDEX,
      ...dynamicEntries({
        providers: providers ?? [],
        projects: projects ?? [],
        models: withModels ? (models ?? []) : [],
        mcpServers: mcpServers ?? [],
      }),
    ],
    [providers, projects, models, mcpServers, withModels],
  );
}
