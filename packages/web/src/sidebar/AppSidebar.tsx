import { FoldersIcon, ListIcon, MessageSquarePlusIcon, SettingsIcon } from "lucide-react";
import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { useOpenSettings } from "@/app/settings-dialog";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
import { errorMessage } from "@/lib/error-message";
import { newThreadPath } from "@/lib/paths";
import type { SidebarMode } from "@/lib/preferences";
import { useAllConversations, useProjects } from "@/lib/queries";
import { ProjectsView } from "./ProjectsView";
import { ThreadsView } from "./ThreadsView";
import { useSidebarMode } from "./use-sidebar-preferences";

const MODE_OPTIONS = [
  { value: "threads", label: "Threads", icon: <ListIcon /> },
  { value: "projects", label: "Projects", icon: <FoldersIcon /> },
] as const satisfies readonly { value: SidebarMode; label: string; icon: React.ReactNode }[];

export function AppSidebar() {
  const [mode, setMode] = useSidebarMode();
  const { projectId, conversationId } = useOpenConversation();
  const projects = useProjects();
  const conversations = useAllConversations();
  const navigate = useNavigate();
  const openSettings = useOpenSettings();
  const onProjectRemoved = (removedId: string) => removedId === projectId && navigate("/");
  const View = mode === "threads" ? ThreadsView : ProjectsView;

  return (
    <Sidebar aria-label="Projects and threads">
      <SidebarHeader className="gap-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => navigate(newThreadPath())}>
            <MessageSquarePlusIcon />
            New thread
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
        {projects.isPending && <SidebarMenuSkeleton showIcon />}
        {projects.isError && <p className="px-4 text-sm text-destructive">{errorMessage(projects.error)}</p>}
        {projects.data && (
          <View
            projects={projects.data}
            conversations={conversations.data ?? []}
            activeConversationId={conversationId}
            onProjectRemoved={onProjectRemoved}
          />
        )}
      </SidebarContent>
      <SidebarFooter>
        <Button variant="ghost" className="justify-start" onClick={openSettings}>
          <SettingsIcon />
          Settings
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
