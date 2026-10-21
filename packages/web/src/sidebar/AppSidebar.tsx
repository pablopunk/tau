import type { DirectoryNode as Node } from "@tau/protocol";
import {
  Command as CommandIcon,
  FoldersIcon,
  ListIcon,
  MessageSquarePlusIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { useOpenSettings } from "@/app/settings-dialog";
import { BrandText } from "@/components/ui/brand-text";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { TauLogo } from "@/components/ui/tau-logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { newThreadPath } from "@/lib/paths";
import { preferences, type SidebarMode } from "@/lib/preferences";
import { NodeProvider, useNodes } from "@/nodes";
import { isUsable } from "@/nodes/node-text";
import { useHubName } from "@/nodes/use-node-avatar";
import { openPalette } from "@/palette/palette-open";
import { ArchiveButton, DeleteAllArchivedButton } from "./GlobalArchive";
import { NodeGroup } from "./NodeGroup";
import { NodeSection } from "./NodeSection";
import { OfflineNodeSection } from "./OfflineNodeSection";
import { UpdateButton } from "./UpdateButton";
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

function RemoteGroup({ node, mode, showArchived }: { node: Node; mode: SidebarMode; showArchived: boolean }) {
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
            showArchived={showArchived}
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

function NodeSections({ mode, showArchived }: { mode: SidebarMode; showArchived: boolean }) {
  const { nodes } = useNodes();
  const hubName = useHubName();
  const open = useOpenConversation();
  const navigate = useNavigate();
  const local = (
    <NodeSection
      mode={mode}
      showArchived={showArchived}
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
        <RemoteGroup key={node.id} node={node} mode={mode} showArchived={showArchived} />
      ))}
    </>
  );
}

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();
  const [mode, setMode] = useSidebarMode();
  const [showArchived, setShowArchived] = useState(() => preferences.getShowArchived());
  const navigate = useNavigate();
  const openSettings = useOpenSettings();
  const toggleArchived = () => {
    const next = !showArchived;
    preferences.setShowArchived(next);
    setShowArchived(next);
  };
  return (
    <Sidebar aria-label="Projects and threads">
      <SidebarHeader className="gap-4 px-4 py-3">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openPalette}
                aria-label="Open command palette"
                className="flex size-5 cursor-pointer items-center justify-center justify-self-start rounded text-foreground"
              >
                <TauLogo className="size-5 group-hover:hidden pointer-coarse:hidden" />
                <CommandIcon className="hidden size-4 group-hover:block pointer-coarse:block" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Open command palette</TooltipContent>
          </Tooltip>
          <BrandText className="text-base font-semibold drop-shadow-sm">tau</BrandText>
          <SidebarTrigger className="hidden size-8 shrink-0 justify-self-end md:inline-flex [&_svg:not([class*='size-'])]:size-5" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close sidebar"
            onClick={() => setOpenMobile(false)}
            className="shrink-0 justify-self-end md:hidden"
          >
            <XIcon />
          </Button>
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
        <NodeSections mode={mode} showArchived={showArchived} />
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" className="min-w-0 justify-start" onClick={openSettings}>
            <SettingsIcon />
            Settings
          </Button>
          <div className="flex shrink-0 items-center gap-1">
            {showArchived && <DeleteAllArchivedButton />}
            <ArchiveButton show={showArchived} onToggle={toggleArchived} />
            <UpdateButton />
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
