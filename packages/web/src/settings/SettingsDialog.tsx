import type { ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";
import { SettingsDialogContent, SettingsLayout } from "@/components/ui/settings-layout";
import { CodeFolderSuggestion } from "@/github/CodeFolderSuggestion";
import { GithubSettingsRow } from "@/github/GithubSettingsRow";
import { AgentSection } from "./agent/AgentSection";
import { GeneralSection } from "./GeneralSection";
import { ProjectsFolderField } from "./ProjectsFolderField";
import { ProvidersSection } from "./ProvidersSection";
import { SettingsModels } from "./SettingsModels";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./sections";
import { ToolsSection } from "./tools/ToolsSection";

const sectionBodies: Record<SettingsSectionId, () => ReactNode> = {
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

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
}

export function SettingsDialog({ open, onOpenChange, section, onSectionChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SettingsDialogContent aria-describedby={undefined}>
        <SettingsLayout
          title="Settings"
          sections={SETTINGS_SECTIONS}
          active={section}
          onActiveChange={(id) => onSectionChange(id as SettingsSectionId)}
        >
          {sectionBodies[section]()}
        </SettingsLayout>
      </SettingsDialogContent>
    </Dialog>
  );
}
