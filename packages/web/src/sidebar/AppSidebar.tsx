import { FolderPlusIcon, SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
import { errorMessage } from "@/lib/error-message";
import { useProjects } from "@/lib/queries";
import { onOpenSettingsRequested } from "@/palette/settings-event";
import { SettingsDialog } from "@/setup/SettingsDialog";
import { AddProjectDialog } from "./AddProjectDialog";
import { ProjectGroup } from "./ProjectGroup";

export function AppSidebar() {
  const [adding, setAdding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { projectId, conversationId } = useOpenConversation();
  const projects = useProjects();
  const navigate = useNavigate();

  useEffect(() => onOpenSettingsRequested(() => setSettingsOpen(true)), []);

  return (
    <Sidebar aria-label="Projects and chats">
      <SidebarHeader className="flex-row items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold">pi-everywhere</span>
        <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
          <FolderPlusIcon />
          Add project
        </Button>
      </SidebarHeader>
      <SidebarContent>
        {projects.isPending && <SidebarMenuSkeleton showIcon />}
        {projects.isError && <p className="px-4 text-sm text-destructive">{errorMessage(projects.error)}</p>}
        {projects.data?.map((project) => (
          <ProjectGroup
            key={project.id}
            project={project}
            activeConversationId={project.id === projectId ? conversationId : undefined}
            onRemoved={() => project.id === projectId && navigate("/")}
          />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <Button variant="ghost" className="justify-start" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon />
          Settings
        </Button>
      </SidebarFooter>
      {adding && <AddProjectDialog onClose={() => setAdding(false)} />}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </Sidebar>
  );
}
