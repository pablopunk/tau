import type { Node } from "@tau/protocol";
import { useState } from "react";
import { Dialog, DialogDescription } from "@/components/ui/dialog";
import { SettingsDialogContent, SettingsLayout } from "@/components/ui/settings-layout";
import { CodeFolderSuggestion } from "@/github/CodeFolderSuggestion";
import { NodeProvider } from "@/nodes";
import { ClaudeConnectorsSection } from "./ClaudeConnectorsSection";
import { ProjectsFolderField } from "./ProjectsFolderField";
import { ProvidersSection } from "./ProvidersSection";

/** The settings that make sense on another node. Remote access, Devices and Nodes would show the hub's data. */
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

export function NodeSettingsDialog({ node, onClose }: { node: Node; onClose: () => void }) {
  const [section, setSection] = useState<SectionId>("providers");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <SettingsDialogContent aria-describedby={undefined}>
        <DialogDescription className="sr-only">Settings of the node {node.name}</DialogDescription>
        <NodeProvider nodeId={node.id}>
          <SettingsLayout
            title={`Settings for ${node.name}`}
            sections={SECTIONS}
            active={section}
            onActiveChange={(id) => setSection(id as SectionId)}
          >
            {BODIES[section]()}
          </SettingsLayout>
        </NodeProvider>
      </SettingsDialogContent>
    </Dialog>
  );
}
