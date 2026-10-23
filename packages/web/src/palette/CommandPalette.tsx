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
import { NodeName } from "@/components/ui/node-name";
import { useSidebar } from "@/components/ui/sidebar";
import { HandoffDialog } from "@/handoff/HandoffDialog";
import { useHotkey } from "@/lib/hotkeys";
import { conversationPath, newThreadPath } from "@/lib/paths";
import { type NodeData, useNodesData } from "@/nodes";
import { NodeScope } from "@/nodes/NodeScope";
import { SETTINGS_SECTIONS } from "@/settings/sections";
import { useWarmOnIntent } from "@/sidebar/use-warm-on-intent";
import { AddProjectFlow, type AddProjectStep } from "./AddProjectFlow";
import { useAdjacentThread } from "./adjacent-thread";
import { ModelPage } from "./ModelPage";
import { NodePage, type NodePick } from "./NodePage";
import { usePaletteOpen } from "./palette-open";
import { SettingsItem } from "./SettingsItem";
import { SettingsSearchGroup, useSettingResults } from "./SettingsSearchGroup";
import { ThinkingPage } from "./ThinkingPage";
import { ThreadActions } from "./ThreadActions";
import { threadPaletteLabel } from "./thread-palette-label";

interface HandoffTarget {
  conversationId: string;
  nodeId: string | undefined;
}

const nodeKeyOf = (nodeId: string | undefined) => nodeId ?? "local";

interface SectionsProps {
  search: string;
  allNodes: readonly NodeData[];
  several: boolean;
  run: (action: () => void) => () => void;
  chooseNode: (pick: NodePick) => void;
  startAddProject: (nodeId: string | undefined) => void;
  openModelPage: () => void;
  openThinkingPage: () => void;
  startHandoff: (target: HandoffTarget) => void;
}

function ThreadPaletteItem({
  conversation,
  nodeId,
  nodeName,
  projectName,
  several,
  onSelect,
}: {
  conversation: NodeData["conversations"][number];
  nodeId: string | undefined;
  nodeName: string;
  projectName: string;
  several: boolean;
  onSelect: () => void;
}) {
  const hasWorktree =
    conversation.workspace.mode === "worktree" && conversation.workspace.state !== "removed";
  const { warmNow, handlers: warmHandlers } = useWarmOnIntent(
    conversation.id,
    nodeId === undefined,
    hasWorktree,
  );
  return (
    <CommandItem
      {...warmHandlers}
      value={`thread ${conversation.title} ${projectName} ${conversation.id} ${nodeName}`}
      onSelect={() => {
        warmNow();
        onSelect();
      }}
    >
      {conversation.title.trim() || "New thread"}
      <span className="ml-auto text-xs text-muted-foreground">
        {threadPaletteLabel(nodeName, projectName, several)}
      </span>
    </CommandItem>
  );
}

function MainSections({
  search,
  allNodes,
  several,
  run,
  chooseNode,
  startAddProject,
  openModelPage,
  openThinkingPage,
  startHandoff,
}: SectionsProps) {
  const navigate = useNavigate();
  const adjacent = useAdjacentThread();
  const { toggleSidebar } = useSidebar();
  const { projectId, conversationId, nodeId: openNodeId } = useOpenConversation();
  const openThread = allNodes
    .find((node) => node.nodeId === openNodeId)
    ?.conversations.find((conversation) => conversation.id === conversationId);
  const settingResults = useSettingResults(search);
  const newThread = several
    ? () =>
        chooseNode({
          heading: "New thread on",
          onPick: (nodeId) => navigate(newThreadPath(nodeId === openNodeId ? projectId : undefined, nodeId)),
        })
    : run(() => navigate(newThreadPath(projectId, openNodeId)));
  const addProject = several
    ? () => chooseNode({ heading: "Add project on", onPick: startAddProject })
    : run(() => startAddProject(undefined));
  return (
    <>
      {settingResults.length === 0 && <CommandEmpty>No results.</CommandEmpty>}
      {projectId && conversationId ? (
        <NodeScope nodeId={openNodeId}>
          <ThreadActions
            projectId={projectId}
            conversationId={conversationId}
            archived={openThread?.archivedAt != null}
            onChangeModel={openModelPage}
            onChangeThinking={openThinkingPage}
            onHandoff={() => startHandoff({ conversationId, nodeId: openNodeId })}
            run={run}
          />
        </NodeScope>
      ) : null}
      <CommandGroup heading="Actions">
        <CommandItem onSelect={newThread}>New thread</CommandItem>
        <CommandItem onSelect={addProject}>Add project</CommandItem>
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
        {allNodes.flatMap((node) =>
          node.projects.map((project) => (
            <CommandItem
              key={`${nodeKeyOf(node.nodeId)}:${project.id}`}
              value={`project ${project.name} ${project.id} ${node.name}`}
              onSelect={run(() => navigate(newThreadPath(project.id, node.nodeId)))}
            >
              {project.name}
              {several ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  <NodeName name={node.name} local={node.local} />
                </span>
              ) : null}
            </CommandItem>
          )),
        )}
      </CommandGroup>
      <CommandGroup heading="Threads">
        {allNodes.flatMap((node) =>
          node.conversations.map((conversation) => {
            const projectName =
              node.projects.find((project) => project.id === conversation.projectId)?.name ?? "";
            return (
              <ThreadPaletteItem
                key={`${nodeKeyOf(node.nodeId)}:${conversation.id}`}
                conversation={conversation}
                nodeId={node.nodeId}
                nodeName={node.name}
                projectName={projectName}
                several={several}
                onSelect={run(() =>
                  navigate(conversationPath(conversation.projectId, conversation.id, node.nodeId)),
                )}
              />
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
  node: "Search nodes",
};

export function CommandPalette() {
  const [open, setOpen] = usePaletteOpen();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<"model" | "thinking" | "node" | null>(null);
  const [nodePick, setNodePick] = useState<NodePick | null>(null);
  const [addProject, setAddProject] = useState<AddProjectStep | null>(null);
  const [handoff, setHandoff] = useState<HandoffTarget | null>(null);
  const { conversationId, nodeId: openNodeId } = useOpenConversation();
  const everyNode = useNodesData();
  useHotkey("mod+k", () => setOpen((current) => !current));

  const startAddProject = (nodeId: string | undefined) => setAddProject({ nodeId });

  const chooseNode = (pick: NodePick) => {
    setSearch("");
    setNodePick(pick);
    setPage("node");
  };

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
      <AddProjectFlow state={addProject} onChange={setAddProject} />
      {handoff ? (
        <NodeScope nodeId={handoff.nodeId}>
          <HandoffDialog conversationId={handoff.conversationId} onClose={() => setHandoff(null)} />
        </NodeScope>
      ) : null}
      <CommandDialog open={open} onOpenChange={changeOpen} title="Command palette">
        <Command key={page ?? "main"} onKeyDown={backFromEmptySearch}>
          <CommandInput
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder={PLACEHOLDERS[page ?? "main"]}
          />
          <CommandList>
            {page === "node" && nodePick ? (
              <>
                <CommandEmpty>No results.</CommandEmpty>
                <NodePage nodes={everyNode} openNodeId={openNodeId} pick={nodePick} run={run} />
              </>
            ) : page !== null && page !== "node" && conversationId ? (
              <NodeScope nodeId={openNodeId}>
                <CommandEmpty>No results.</CommandEmpty>
                {page === "model" ? (
                  <ModelPage conversationId={conversationId} run={run} />
                ) : (
                  <ThinkingPage conversationId={conversationId} run={run} />
                )}
              </NodeScope>
            ) : (
              <MainSections
                search={search}
                allNodes={everyNode}
                several={everyNode.length > 1}
                run={run}
                chooseNode={chooseNode}
                startAddProject={startAddProject}
                openModelPage={openPage("model")}
                openThinkingPage={openPage("thinking")}
                startHandoff={setHandoff}
              />
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
