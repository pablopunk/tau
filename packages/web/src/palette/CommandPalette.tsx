import { type KeyboardEvent, useState } from "react";
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
import { useHotkey } from "@/lib/hotkeys";
import { conversationPath, newThreadPath } from "@/lib/paths";
import { type MachineData, useMachinesData } from "@/machines";
import { MachineScope } from "@/machines/MachineScope";
import { SETTINGS_SECTIONS } from "@/settings/sections";
import { AddProjectFlow, type AddProjectStep } from "./AddProjectFlow";
import { useAdjacentThread } from "./adjacent-thread";
import { MachineFilter, machineKeyOf } from "./MachineFilter";
import { ModelPage } from "./ModelPage";
import { SettingsItem } from "./SettingsItem";
import { SettingsSearchGroup, useSettingResults } from "./SettingsSearchGroup";
import { ThinkingPage } from "./ThinkingPage";
import { ThreadActions } from "./ThreadActions";

interface SectionsProps {
  search: string;
  allMachines: readonly MachineData[];
  machines: readonly MachineData[];
  several: boolean;
  run: (action: () => void) => () => void;
  startAddProject: () => void;
  openModelPage: () => void;
  openThinkingPage: () => void;
}

function MainSections({
  search,
  allMachines,
  machines,
  several,
  run,
  startAddProject,
  openModelPage,
  openThinkingPage,
}: SectionsProps) {
  const navigate = useNavigate();
  const adjacent = useAdjacentThread();
  const { toggleSidebar } = useSidebar();
  const { projectId, conversationId, machineId: openMachineId } = useOpenConversation();
  const openThread = allMachines
    .find((machine) => machine.machineId === openMachineId)
    ?.conversations.find((conversation) => conversation.id === conversationId);
  const settingResults = useSettingResults(search);
  return (
    <>
      {settingResults.length === 0 && <CommandEmpty>No results.</CommandEmpty>}
      {projectId && conversationId ? (
        <MachineScope machineId={openMachineId}>
          <ThreadActions
            projectId={projectId}
            conversationId={conversationId}
            archived={openThread?.archivedAt != null}
            onChangeModel={openModelPage}
            onChangeThinking={openThinkingPage}
            run={run}
          />
        </MachineScope>
      ) : null}
      <CommandGroup heading="Actions">
        <CommandItem onSelect={run(() => navigate(newThreadPath(projectId, openMachineId)))}>
          New thread
        </CommandItem>
        <CommandItem onSelect={run(startAddProject)}>Add project</CommandItem>
        {adjacent.available ? (
          <>
            <CommandItem onSelect={run(() => adjacent.go(1))}>
              Next thread
              <CommandShortcut>⌘⌥↓</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(() => adjacent.go(-1))}>
              Previous thread
              <CommandShortcut>⌘⌥↑</CommandShortcut>
            </CommandItem>
          </>
        ) : null}
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
              {several ? <span className="ml-auto text-xs text-muted-foreground">{machine.name}</span> : null}
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
    </>
  );
}

const PLACEHOLDERS = {
  main: "Search threads, projects, actions, settings",
  model: "Search models",
  thinking: "Search thinking levels",
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<"model" | "thinking" | null>(null);
  const [machineFilter, setMachineFilter] = useState<string[]>([]);
  const [addProject, setAddProject] = useState<AddProjectStep | null>(null);
  const { conversationId, machineId: openMachineId } = useOpenConversation();
  const everyMachine = useMachinesData();
  const machines = everyMachine.filter(
    (machine) => machineFilter.length === 0 || machineFilter.includes(machineKeyOf(machine.machineId)),
  );
  useHotkey("mod+k", () => setOpen((current) => !current));

  const startAddProject = () =>
    setAddProject(everyMachine.length > 1 ? { step: "choose" } : { step: "add", machineId: undefined });

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setPage(null);
  };

  const run = (action: () => void) => () => {
    changeOpen(false);
    setSearch("");
    action();
  };

  const openPage = (next: "model" | "thinking") => () => {
    setSearch("");
    setPage(next);
  };

  const backFromEmptySearch = (event: KeyboardEvent<HTMLElement>) => {
    if (page !== null && search === "" && event.key === "Backspace") setPage(null);
  };

  return (
    <>
      <AddProjectFlow state={addProject} machines={everyMachine} onChange={setAddProject} />
      <CommandDialog open={open} onOpenChange={changeOpen} title="Command palette">
        <Command onKeyDown={backFromEmptySearch}>
          <CommandInput value={search} onValueChange={setSearch} placeholder={PLACEHOLDERS[page ?? "main"]} />
          {page === null && everyMachine.length > 1 ? (
            <MachineFilter machines={everyMachine} selected={machineFilter} onChange={setMachineFilter} />
          ) : null}
          <CommandList>
            {page !== null && conversationId ? (
              <MachineScope machineId={openMachineId}>
                <CommandEmpty>No results.</CommandEmpty>
                {page === "model" ? (
                  <ModelPage conversationId={conversationId} run={run} />
                ) : (
                  <ThinkingPage conversationId={conversationId} run={run} />
                )}
              </MachineScope>
            ) : (
              <MainSections
                search={search}
                allMachines={everyMachine}
                machines={machines}
                several={everyMachine.length > 1}
                run={run}
                startAddProject={startAddProject}
                openModelPage={openPage("model")}
                openThinkingPage={openPage("thinking")}
              />
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
