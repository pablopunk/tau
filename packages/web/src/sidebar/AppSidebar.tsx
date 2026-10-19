import type { Node } from "@tau/protocol";
import { FoldersIcon, ListIcon, MessageSquarePlusIcon, SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { useOpenSettings } from "@/app/settings-dialog";
import { Button } from "@/components/ui/button";
import { NodeName } from "@/components/ui/node-name";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TauLogo } from "@/components/ui/tau-logo";
import { newThreadPath } from "@/lib/paths";
import type { SidebarMode } from "@/lib/preferences";
import { NodeProvider, useNodes } from "@/nodes";
import { isUsable } from "@/nodes/node-text";
import { useHubName } from "@/nodes/use-node-avatar";
import { NodeGroup } from "./NodeGroup";
import { NodeSection } from "./NodeSection";
import { OfflineNodeSection } from "./OfflineNodeSection";
import { useSidebarMode } from "./use-sidebar-preferences";

const MODE_OPTIONS = [
  { value: "threads", label: "Threads", icon: <ListIcon /> },
  { value: "projects", label: "Projects", icon: <FoldersIcon /> },
] as const satisfies readonly { value: SidebarMode; label: string; icon: React.ReactNode }[];

const sameNode = (open: string | undefined, nodeId: string | undefined) => open === nodeId;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function RemoteGroup({ node, mode }: { node: Node; mode: SidebarMode }) {
  const open = useOpenConversation();
  const navigate = useNavigate();
  const now = useNow();
  const active = sameNode(open.nodeId, node.id);
  return (
    <NodeGroup node={node} name={node.name}>
      {isUsable(node) ? (
        <NodeProvider nodeId={node.id}>
          <NodeSection
            mode={mode}
            activeConversationId={active ? open.conversationId : undefined}
            onProjectRemoved={(removedId) => active && removedId === open.projectId && navigate("/")}
          />
        </NodeProvider>
      ) : (
        <OfflineNodeSection node={node} now={now} />
      )}
    </NodeGroup>
  );
}

function NodeSections({ mode }: { mode: SidebarMode }) {
  const { nodes } = useNodes();
  const hubName = useHubName();
  const open = useOpenConversation();
  const navigate = useNavigate();
  const local = (
    <NodeSection
      mode={mode}
      activeConversationId={sameNode(open.nodeId, undefined) ? open.conversationId : undefined}
      onProjectRemoved={(removedId) =>
        open.nodeId === undefined && removedId === open.projectId && navigate("/")
      }
    />
  );
  if (nodes.length === 0) return local;
  return (
    <>
      <NodeGroup node={undefined} name={hubName} local>
        {local}
      </NodeGroup>
      {nodes.map((node) => (
        <RemoteGroup key={node.id} node={node} mode={mode} />
      ))}
    </>
  );
}

export function AppSidebar() {
  const [mode, setMode] = useSidebarMode();
  const navigate = useNavigate();
  const openSettings = useOpenSettings();
  return (
    <Sidebar aria-label="Projects and threads">
      <SidebarHeader className="gap-2 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <TauLogo />
          <SidebarTrigger className="hidden shrink-0 md:inline-flex" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" className="min-w-0" onClick={() => navigate(newThreadPath())}>
            <MessageSquarePlusIcon />
            <span className="truncate">New thread</span>
          </Button>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={MODE_OPTIONS}
            aria-label="Sidebar view"
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NodeSections mode={mode} />
      </SidebarContent>
      <SidebarFooter>
        <Button variant="ghost" className="justify-start" onClick={openSettings}>
          <SettingsIcon />
          Settings
        </Button>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
