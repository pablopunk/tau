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
import { SETTINGS_SECTIONS } from "@/settings/sections";
import { SettingsItem } from "./SettingsItem";
import { SettingsSearchGroup, useSettingResults } from "./SettingsSearchGroup";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { projectId } = useOpenConversation();
  const conversations = useAllConversations().data ?? [];
  const projects = useProjects().data ?? [];
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? "";
  const settingResults = useSettingResults(search);
  useHotkey("mod+k", () => setOpen((current) => !current));

  const run = (action: () => void) => () => {
    setOpen(false);
    setSearch("");
    action();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette">
      <Command>
        <CommandInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search threads, projects, actions, settings"
        />
        <CommandList>
          {settingResults.length === 0 && <CommandEmpty>No results.</CommandEmpty>}
          <CommandGroup heading="Actions">
            <CommandItem onSelect={run(() => navigate(newThreadPath(projectId)))}>New thread</CommandItem>
            {SETTINGS_SECTIONS.map((section) => (
              <SettingsItem key={section.id} section={section} run={run} />
            ))}
          </CommandGroup>
          <SettingsSearchGroup search={search} results={settingResults} run={run} />
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
                {conversation.title.trim() || "New thread"}
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
