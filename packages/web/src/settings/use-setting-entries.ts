import { useMemo } from "react";
import { useOpenConversation } from "@/activity";
import { useMcpServers, useModels, useProjects, useProviders } from "@/lib/queries";
import { dynamicEntries, SETTINGS_INDEX, type SettingEntry } from "./settings-index";

/** The fixed index plus one entry per provider, project, MCP server and model. */
export function useSettingEntries(): SettingEntry[] {
  const { projectId } = useOpenConversation();
  const providers = useProviders().data;
  const projects = useProjects().data;
  const models = useModels().data;
  const mcpServers = useMcpServers(projectId ?? null).data;
  return useMemo(
    () => [
      ...SETTINGS_INDEX,
      ...dynamicEntries({
        providers: providers ?? [],
        projects: projects ?? [],
        models: models ?? [],
        mcpServers: mcpServers ?? [],
      }),
    ],
    [providers, projects, models, mcpServers],
  );
}
