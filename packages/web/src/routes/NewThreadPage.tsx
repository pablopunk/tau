import { useQueryClient } from "@tanstack/react-query";
import type { FileRef, ImageInput, ModelRef, ThinkingLevel, WorkspaceMode } from "@tau/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ModelThinkingPickers, type PickersHandle } from "@/components/ModelThinkingPickers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Composer } from "@/conversation";
import type { CommandHandlers } from "@/conversation/composer/slash-commands";
import { NATIVE_ATTACHMENTS_REASON } from "@/conversation/model/executor";
import { errorMessage } from "@/lib/error-message";
import { findModel, pickModel, pickProjectId, pickThinkingLevel } from "@/lib/new-thread-defaults";
import { clearNewThreadDraft, loadNewThreadDraft, saveNewThreadDraft } from "@/lib/new-thread-draft";
import { conversationPath, newThreadPath } from "@/lib/paths";
import { preferences } from "@/lib/preferences";
import { queryKeys, useModels, useProjects, useRuntimes, useSettings } from "@/lib/queries";
import { enabledClaudeCode } from "@/lib/runtimes";
import { clearDraftRequestId, draftRequestId } from "@/lib/start-request";
import { useApi, useNodeId } from "@/nodes/node-context";
import { WorktreeToggle } from "@/workspaces/WorktreeToggle";
import { type FirstMessage, firstMessageState } from "./first-message";
import { NotSetUpNotice } from "./NotSetUpNotice";
import { ProjectPicker } from "./ProjectPicker";
import { StartingThread } from "./StartingThread";

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
  const runtimes = useRuntimes();
  const [initialDraft] = useState(() => loadNewThreadDraft(nodeId));
  const [chosenProject, setProject] = useState<string | null>(initialDraft.projectId);
  const [chosenModel, setModel] = useState<ModelRef | null>(initialDraft.model);
  const [chosenLevel, setLevel] = useState<ThinkingLevel | null>(initialDraft.thinkingLevel);
  const [workspace, setWorkspace] = useState<WorkspaceMode | null>(initialDraft.workspace);
  const [busy, setBusy] = useState(false);
  const [startingMessage, setStartingMessage] = useState<FirstMessage>();
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
  // A failing or old node has no runtimes answer: fall back to Pi (see useRuntimes).
  const runtimesReady = runtimes.data !== undefined || runtimes.isError;
  if (!projects.data || !models.data || !settings.data || !runtimesReady) {
    const failed = [projects, models, settings].filter((query) => query.isError);
    if (failed.length === 0) return <NewThreadSkeleton />;
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load the new thread</AlertTitle>
        <AlertDescription>{errorMessage(failed[0]?.error)}</AlertDescription>
        <Button
          variant="outline"
          disabled={failed.some((query) => query.isFetching)}
          onClick={() => {
            for (const query of failed) void query.refetch();
          }}
        >
          Retry loading
        </Button>
      </Alert>
    );
  }

  const wantedProject = paramProject ?? chosenProject ?? preferences.getLastProjectId(nodeId);
  const projectId = pickProjectId(projects.data, wantedProject);
  const lastModel = chosenModel ?? preferences.getLastModel(nodeId);
  const model = pickModel(models.data, lastModel, settings.data.defaultModel);
  const level = pickThinkingLevel(
    model,
    chosenLevel ?? settings.data.defaultThinkingLevel ?? preferences.getLastThinkingLevel(nodeId),
  );
  // A Claude model takes the native executor when the node offers it; when it
  // does not, the start says Pi explicitly so the server keeps the legacy
  // provider path instead of routing an omitted executor to native.
  const claudeModel = model?.provider === "claude-cli";
  const native = claudeModel && enabledClaudeCode(runtimes.data) !== undefined;
  const executor = !claudeModel ? undefined : native ? ("claude-code" as const) : ("pi" as const);
  const levels = native
    ? ["off" as const]
    : (findModel(models.data, model ?? null)?.thinkingLevels ?? ["off"]);

  const notSetUp = models.data.length === 0;
  const cloning = projects.data.find((project) => project.id === projectId)?.status === "cloning";

  const start = async ({ text, images, files }: { text: string; images: ImageInput[]; files: FileRef[] }) => {
    setStartingMessage({ text, images, files });
    setBusy(true);
    try {
      const created = await api.conversations.start({
        projectId,
        text,
        requestId: draftRequestId(),
        ...(model && { model: toRef(model) }),
        ...(!native && { thinkingLevel: level }),
        ...(workspace && { workspace }),
        ...(images.length > 0 && { images }),
        ...(files.length > 0 && { files }),
        ...(executor && { executor }),
      });
      clearDraftRequestId();
      clearNewThreadDraft(nodeId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      preferences.setLastProjectId(created.projectId, nodeId);
      if (model) preferences.setLastModel(toRef(model), nodeId);
      if (!native) preferences.setLastThinkingLevel(level, nodeId);
      navigate(conversationPath(created.projectId, created.id, nodeId), {
        state: firstMessageState({ text, images, files }),
      });
    } catch (error) {
      setStartingMessage(undefined);
      throw error;
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
    <StartingThread
      message={startingMessage}
      normalContent={
        <>
          <h2 className="text-lg font-semibold">New thread</h2>
          {notSetUp ? <NotSetUpNotice nodeId={nodeId} /> : null}
        </>
      }
      composer={
        <div
          className={
            startingMessage
              ? "mx-auto w-full max-w-3xl px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
              : "w-full max-w-2xl"
          }
        >
          <Composer
            target="new"
            imagesAllowed={!native && (model?.images ?? true)}
            attachmentsBlockedReason={native ? NATIVE_ATTACHMENTS_REASON : undefined}
            busy={busy}
            disabled={busy || cloning || notSetUp}
            disabledReason={busy ? "Starting thread…" : undefined}
            hint={busy ? <Spinner aria-label="Starting thread" /> : undefined}
            toolbar={toolbar}
            projectId={projectId}
            commands={native ? { model: commands.model } : commands}
            onSend={start}
          />
        </div>
      }
    />
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
