import type { Machine } from "@tau/protocol";
import { useState } from "react";
import { Dialog, DialogDescription } from "@/components/ui/dialog";
import { SettingsDialogContent, SettingsLayout } from "@/components/ui/settings-layout";
import { CodeFolderSuggestion } from "@/github/CodeFolderSuggestion";
import { MachineProvider } from "@/machines";
import { ClaudeConnectorsSection } from "./ClaudeConnectorsSection";
import { ProjectsFolderField } from "./ProjectsFolderField";
import { ProvidersSection } from "./ProvidersSection";

/** The settings that make sense on another machine. Remote access, Devices and Machines would show the hub's data. */
const SECTIONS = [
  { id: "providers", label: "Providers" },
  { id: "projects", label: "Projects" },
  { id: "connectors", label: "Connectors" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const BODIES: Record<SectionId, () => React.ReactNode> = {
  providers: () => <ProvidersSection />,
  projects: () => (
    <>
      <ProjectsFolderField />
      <CodeFolderSuggestion />
    </>
  ),
  connectors: () => <ClaudeConnectorsSection />,
};

export function MachineSettingsDialog({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const [section, setSection] = useState<SectionId>("providers");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <SettingsDialogContent aria-describedby={undefined}>
        <DialogDescription className="sr-only">Settings of the machine {machine.name}</DialogDescription>
        <MachineProvider machineId={machine.id}>
          <SettingsLayout
            title={`Settings for ${machine.name}`}
            sections={SECTIONS}
            active={section}
            onActiveChange={(id) => setSection(id as SectionId)}
          >
            {BODIES[section]()}
          </SettingsLayout>
        </MachineProvider>
      </SettingsDialogContent>
    </Dialog>
  );
}
