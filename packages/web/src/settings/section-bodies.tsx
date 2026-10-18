import type { ReactNode } from "react";
import { CodeFolderSuggestion } from "@/github/CodeFolderSuggestion";
import { GithubSettingsRow } from "@/github/GithubSettingsRow";
import { AgentSection } from "./agent/AgentSection";
import { GeneralSection } from "./GeneralSection";
import { ProjectsFolderField } from "./ProjectsFolderField";
import { ProvidersSection } from "./ProvidersSection";
import { SettingsModels } from "./SettingsModels";
import type { SettingsSectionId } from "./sections";
import { ToolsSection } from "./tools/ToolsSection";

export const SECTION_BODIES: Record<SettingsSectionId, () => ReactNode> = {
  general: () => <GeneralSection />,
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
