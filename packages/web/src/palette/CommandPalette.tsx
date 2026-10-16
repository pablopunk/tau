import { useState } from "react";
import { useNavigate } from "react-router";
import { useOpenConversation } from "@/activity";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useHotkey } from "@/lib/hotkeys";
import { conversationPath, newThreadPath } from "@/lib/paths";
import { useAllConversations, useProjects } from "@/lib/queries";
import { requestOpenSettings } from "./settings-event";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { projectId } = useOpenConversation();
  const conversations = useAllConversations().data ?? [];
  const projects = useProjects().data ?? [];
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? "";
  useHotkey("mod+k", () => setOpen((current) => !current));

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette">
      <Command>
        <CommandInput placeholder="Search threads, projects, actions" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem onSelect={run(() => navigate(newThreadPath(projectId)))}>New thread</CommandItem>
            <CommandItem onSelect={run(requestOpenSettings)}>Settings</CommandItem>
          </CommandGroup>
          <CommandGroup heading="Projects">
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={`project ${project.name} ${project.id}`}
                onSelect={run(() => navigate(newThreadPath(project.id)))}
              >
                {project.name}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Threads">
            {conversations.map((conversation) => (
              <CommandItem
                key={conversation.id}
                value={`thread ${conversation.title} ${projectName(conversation.projectId)} ${conversation.id}`}
                onSelect={run(() => navigate(conversationPath(conversation.projectId, conversation.id)))}
              >
                {conversation.title.trim() || "New chat"}
                <span className="ml-auto text-xs text-muted-foreground">
                  {projectName(conversation.projectId)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
