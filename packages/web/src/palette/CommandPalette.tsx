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
  CommandShortcut,
} from "@/components/ui/command";
import { useSidebar } from "@/components/ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useHotkey } from "@/lib/hotkeys";
import { conversationPath, newThreadPath } from "@/lib/paths";
import { type MachineData, useMachinesData } from "@/machines";
import { SETTINGS_SECTIONS } from "@/settings/sections";
import { SettingsItem } from "./SettingsItem";
import { SettingsSearchGroup, useSettingResults } from "./SettingsSearchGroup";

const ALL_MACHINES = "all";

const machineKeyOf = (machineId: string | undefined) => machineId ?? "local";

function MachineFilter({
  machines,
  value,
  onChange,
}: {
  machines: readonly MachineData[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label="Machine"
      className="flex-wrap justify-start px-3 py-2"
      value={value}
      onValueChange={(next) => onChange(next || ALL_MACHINES)}
    >
      <ToggleGroupItem value={ALL_MACHINES}>All machines</ToggleGroupItem>
      {machines.map((machine) => (
        <ToggleGroupItem key={machineKeyOf(machine.machineId)} value={machineKeyOf(machine.machineId)}>
          {machine.name}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [machineFilter, setMachineFilter] = useState(ALL_MACHINES);
  const navigate = useNavigate();
  const { projectId, machineId: openMachineId } = useOpenConversation();
  const everyMachine = useMachinesData();
  const several = everyMachine.length > 1;
  const machines = everyMachine.filter(
    (machine) => machineFilter === ALL_MACHINES || machineKeyOf(machine.machineId) === machineFilter,
  );
  const { toggleSidebar } = useSidebar();
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
        {several ? (
          <MachineFilter machines={everyMachine} value={machineFilter} onChange={setMachineFilter} />
        ) : null}
        <CommandList>
          {settingResults.length === 0 && <CommandEmpty>No results.</CommandEmpty>}
          <CommandGroup heading="Actions">
            <CommandItem onSelect={run(() => navigate(newThreadPath(projectId, openMachineId)))}>
              New thread
            </CommandItem>
            <CommandItem onSelect={run(toggleSidebar)}>
              Toggle sidebar
              <CommandShortcut>⌘B</CommandShortcut>
            </CommandItem>
            {SETTINGS_SECTIONS.map((section) => (
              <SettingsItem key={section.id} section={section} run={run} />
            ))}
          </CommandGroup>
          <SettingsSearchGroup search={search} results={settingResults} run={run} />
          <CommandGroup heading="Projects">
            {machines.flatMap((machine) =>
              machine.projects.map((project) => (
                <CommandItem
                  key={`${machineKeyOf(machine.machineId)}:${project.id}`}
                  value={`project ${project.name} ${project.id} ${machine.name}`}
                  onSelect={run(() => navigate(newThreadPath(project.id, machine.machineId)))}
                >
                  {project.name}
                  {several ? (
                    <span className="ml-auto text-xs text-muted-foreground">{machine.name}</span>
                  ) : null}
                </CommandItem>
              )),
            )}
          </CommandGroup>
          <CommandGroup heading="Threads">
            {machines.flatMap((machine) =>
              machine.conversations.map((conversation) => {
                const projectName =
                  machine.projects.find((project) => project.id === conversation.projectId)?.name ?? "";
                return (
                  <CommandItem
                    key={`${machineKeyOf(machine.machineId)}:${conversation.id}`}
                    value={`thread ${conversation.title} ${projectName} ${conversation.id} ${machine.name}`}
                    onSelect={run(() =>
                      navigate(conversationPath(conversation.projectId, conversation.id, machine.machineId)),
                    )}
                  >
                    {conversation.title.trim() || "New thread"}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {several ? `${machine.name} · ${projectName}` : projectName}
                    </span>
                  </CommandItem>
                );
              }),
            )}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
