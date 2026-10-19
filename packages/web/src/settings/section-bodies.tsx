import type { ReactNode } from "react";
import { CodeFolderSuggestion } from "@/github/CodeFolderSuggestion";
import { GithubSettingsRow } from "@/github/GithubSettingsRow";
import { AgentSection } from "./agent/AgentSection";
import { GeneralSection } from "./GeneralSection";
import { NodesSection } from "./NodesSection";
import { ProjectsFolderField } from "./ProjectsFolderField";
import { ProvidersSection } from "./ProvidersSection";
import { RemoteSection } from "./RemoteSection";
import { SettingsModels } from "./SettingsModels";
import type { SettingsSectionId } from "./sections";
import { ToolsSection } from "./tools/ToolsSection";

/** App-level bodies: not scoped to any one node. */
export const SECTION_BODIES: Record<SettingsSectionId, () => ReactNode> = {
  general: () => <GeneralSection />,
  remote: () => <RemoteSection />,
  nodes: () => <NodesSection />,
  providers: () => <ProvidersSection />,
  models: () => <SettingsModels />,
  projects: () => (
    <>
      <ProjectsFolderField />
      <CodeFolderSuggestion />
    </>
  ),
  github: () => <GithubSettingsRow />,
  agent: () => <AgentSection />,
  tools: () => <ToolsSection />,
};
