import type { DirectoryNode } from "@tau/protocol";
import { NodeAvatar } from "@/components/ui/node-avatar";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { useNodes } from "@/nodes";
import { useNodeAvatar } from "@/nodes/use-node-avatar";
import {
  APP_SECTIONS,
  DEFAULT_NODE_SECTION,
  isNodeSection,
  NODE_SECTIONS,
  type SettingsSectionId,
} from "./sections";

export interface ActiveTab {
  readonly section: SettingsSectionId;
  /** Only meaningful when `section` is a node section. `undefined`: this node. */
  readonly nodeId: string | undefined;
}

function NodeTab({
  id,
  name,
  active,
  onPickNode,
  onPickSection,
  activeSection,
}: {
  id: string | undefined;
  name: string;
  active: boolean;
  onPickNode: (id: string | undefined) => void;
  onPickSection: (id: SettingsSectionId) => void;
  activeSection: SettingsSectionId;
}) {
  const { os, status } = useNodeAvatar(id);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        aria-current={active ? "page" : undefined}
        onClick={() => onPickNode(id)}
      >
        <NodeAvatar os={os} status={status} />
        <span className="truncate">{name}</span>
      </SidebarMenuButton>
      {active ? (
        <SidebarMenuSub>
          {NODE_SECTIONS.map((section) => (
            <SidebarMenuSubItem key={section.id}>
              <SidebarMenuButton
                size="sm"
                isActive={section.id === activeSection}
                aria-current={section.id === activeSection ? "page" : undefined}
                onClick={() => onPickSection(section.id)}
              >
                {section.label}
              </SidebarMenuButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

/**
 * The settings nav: app-level items (General, Remote access, Nodes), then one tab per node (This node, then every
 * linked node), each expanding to its own Providers/Models/Projects/GitHub/Agent/Tools once selected.
 */
export function SettingsNav({
  active,
  onChange,
}: {
  active: ActiveTab;
  onChange: (next: ActiveTab) => void;
}) {
  const { nodes } = useNodes();
  const activeNodeTab = isNodeSection(active.section) ? active.nodeId : undefined;
  const nodeTabSelected = isNodeSection(active.section);

  const pickApp = (id: (typeof APP_SECTIONS)[number]["id"]) => onChange({ section: id, nodeId: undefined });
  const pickNode = (nodeId: string | undefined) => onChange({ section: DEFAULT_NODE_SECTION, nodeId });
  const pickNodeSection = (nodeId: string | undefined, section: SettingsSectionId) =>
    onChange({ section, nodeId });

  return (
    <>
      <SidebarGroup className="p-0">
        <SidebarGroupLabel>App</SidebarGroupLabel>
        <SidebarMenu>
          {APP_SECTIONS.map((section) => (
            <SidebarMenuItem key={section.id}>
              <SidebarMenuButton
                isActive={!nodeTabSelected && active.section === section.id}
                aria-current={!nodeTabSelected && active.section === section.id ? "page" : undefined}
                onClick={() => pickApp(section.id)}
              >
                <span>{section.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup className="p-0">
        <SidebarGroupLabel>Nodes</SidebarGroupLabel>
        <SidebarMenu>
          <NodeTab
            id={undefined}
            name="This node"
            active={nodeTabSelected && activeNodeTab === undefined}
            onPickNode={pickNode}
            onPickSection={(section) => pickNodeSection(undefined, section)}
            activeSection={active.section}
          />
          {nodes.map((node: DirectoryNode) => (
            <NodeTab
              key={node.id}
              id={node.id}
              name={node.name}
              active={nodeTabSelected && activeNodeTab === node.id}
              onPickNode={pickNode}
              onPickSection={(section) => pickNodeSection(node.id, section)}
              activeSection={active.section}
            />
          ))}
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}
