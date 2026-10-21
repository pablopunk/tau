import { useQueryClient } from "@tanstack/react-query";
import type { ImageInput, ModelRef, ThinkingLevel, WorkspaceMode } from "@tau/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ModelThinkingPickers, type PickersHandle } from "@/components/ModelThinkingPickers";
import { Skeleton } from "@/components/ui/skeleton";
import { Composer } from "@/conversation";
import type { CommandHandlers } from "@/conversation/composer/slash-commands";
import { findModel, pickModel, pickProjectId, pickThinkingLevel } from "@/lib/new-thread-defaults";
import { clearNewThreadDraft, loadNewThreadDraft, saveNewThreadDraft } from "@/lib/new-thread-draft";
import { conversationPath, newThreadPath } from "@/lib/paths";
import { preferences } from "@/lib/preferences";
import { queryKeys, useModels, useProjects, useSettings } from "@/lib/queries";
import { clearDraftRequestId, draftRequestId } from "@/lib/start-request";
import { useApi, useNodeId } from "@/nodes/node-context";
import { WorktreeToggle } from "@/workspaces/WorktreeToggle";
import { NotSetUpNotice } from "./NotSetUpNotice";
import { ProjectPicker } from "./ProjectPicker";

const toRef = ({ provider, modelId }: ModelRef): ModelRef => ({ provider, modelId });

export function NewThreadPage() {
  const api = useApi();
  const nodeId = useNodeId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const projects = useProjects();
  const models = useModels();
  const settings = useSettings();
  const [initialDraft] = useState(() => loadNewThreadDraft(nodeId));
  const [chosenProject, setProject] = useState<string | null>(initialDraft.projectId);
  const [chosenModel, setModel] = useState<ModelRef | null>(initialDraft.model);
  const [chosenLevel, setLevel] = useState<ThinkingLevel | null>(initialDraft.thinkingLevel);
  const [workspace, setWorkspace] = useState<WorkspaceMode | null>(initialDraft.workspace);
  const [busy, setBusy] = useState(false);
  const paramProject = params.get("project");

  useEffect(() => {
    saveNewThreadDraft(
      {
        projectId: paramProject ?? chosenProject,
        model: chosenModel,
        thinkingLevel: chosenLevel,
        workspace,
      },
      nodeId,
    );
  }, [paramProject, chosenProject, chosenModel, chosenLevel, workspace, nodeId]);
  const pickers = useRef<PickersHandle>(null);
  const commands = useMemo<CommandHandlers>(
    () => ({
      model: () => pickers.current?.openModel(),
      thinking: () => pickers.current?.openThinking(),
    }),
    [],
  );

  if (!projects.data || !models.data || !settings.data) return <NewThreadSkeleton />;

  const wantedProject = paramProject ?? chosenProject ?? preferences.getLastProjectId(nodeId);
  const projectId = pickProjectId(projects.data, wantedProject);
  const lastModel = chosenModel ?? preferences.getLastModel(nodeId);
  const model = pickModel(models.data, lastModel, settings.data.defaultModel);
  const level = pickThinkingLevel(
    model,
    chosenLevel ?? settings.data.defaultThinkingLevel ?? preferences.getLastThinkingLevel(nodeId),
  );
  const levels = findModel(models.data, model ?? null)?.thinkingLevels ?? ["off"];

  const notSetUp = models.data.length === 0;
  const cloning = projects.data.find((project) => project.id === projectId)?.status === "cloning";

  const start = async ({ text, images }: { text: string; images: ImageInput[] }) => {
    setBusy(true);
    try {
      const created = await api.conversations.start({
        projectId,
        text,
        requestId: draftRequestId(),
        ...(model && { model: toRef(model) }),
        thinkingLevel: level,
        ...(workspace && { workspace }),
        ...(images.length > 0 && { images }),
      });
      clearDraftRequestId();
      clearNewThreadDraft(nodeId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      preferences.setLastProjectId(created.projectId, nodeId);
      if (model) preferences.setLastModel(toRef(model), nodeId);
      preferences.setLastThinkingLevel(level, nodeId);
      navigate(conversationPath(created.projectId, created.id, nodeId));
    } finally {
      setBusy(false);
    }
  };

  const toolbar = (
    <>
      <ProjectPicker
        projects={projects.data}
        projectId={projectId}
        onProject={setProject}
        onNodeProject={(node, project) => navigate(newThreadPath(project, node), { replace: true })}
        disabled={busy}
      />
      <WorktreeToggle projectId={projectId} value={workspace} onChange={setWorkspace} disabled={busy} />
      {cloning ? <span className="text-xs text-muted-foreground">Cloning…</span> : null}
      <ModelThinkingPickers
        ref={pickers}
        models={models.data}
        model={model ? toRef(model) : null}
        onModel={setModel}
        levels={levels}
        level={level}
        onLevel={setLevel}
        disabled={busy}
      />
    </>
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 max-md:justify-end max-md:pb-10">
      <h2 className="text-lg font-semibold">New thread</h2>
      {notSetUp ? <NotSetUpNotice nodeId={nodeId} /> : null}
      <div className="w-full max-w-2xl">
        <Composer
          target="new"
          imagesAllowed={model?.images ?? true}
          busy={busy}
          disabled={cloning || notSetUp}
          toolbar={toolbar}
          projectId={projectId}
          commands={commands}
          onSend={start}
        />
      </div>
    </div>
  );
}

export function NewThreadSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3 p-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
