import type { ImageInput, ModelRef, ThinkingLevel } from "@pi-everywhere/protocol";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ModelThinkingPickers } from "@/components/ModelThinkingPickers";
import { Skeleton } from "@/components/ui/skeleton";
import { Composer } from "@/conversation";
import { api } from "@/lib/api";
import { findModel, pickModel, pickProjectId, pickThinkingLevel } from "@/lib/new-thread-defaults";
import { conversationPath } from "@/lib/paths";
import { preferences } from "@/lib/preferences";
import { useModels, useProjects, useSettings } from "@/lib/queries";
import { clearDraftRequestId, draftRequestId } from "@/lib/start-request";
import { ProjectPicker } from "./ProjectPicker";

const toRef = ({ provider, modelId }: ModelRef): ModelRef => ({ provider, modelId });

export function NewThreadPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const projects = useProjects();
  const models = useModels();
  const settings = useSettings();
  const [chosenProject, setProject] = useState<string | null>(null);
  const [chosenModel, setModel] = useState<ModelRef | null>(null);
  const [chosenLevel, setLevel] = useState<ThinkingLevel | null>(null);
  const [busy, setBusy] = useState(false);

  if (!projects.data || !models.data || !settings.data) return <NewThreadSkeleton />;

  const wantedProject = chosenProject ?? params.get("project") ?? preferences.getLastProjectId();
  const projectId = pickProjectId(projects.data, wantedProject);
  const lastModel = chosenModel ?? preferences.getLastModel();
  const model = pickModel(models.data, lastModel, settings.data.defaultModel);
  const level = pickThinkingLevel(model, chosenLevel ?? preferences.getLastThinkingLevel());
  const levels = findModel(models.data, model ?? null)?.thinkingLevels ?? ["off"];

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
        ...(images.length > 0 && { images }),
      });
      clearDraftRequestId();
      preferences.setLastProjectId(created.projectId);
      if (model) preferences.setLastModel(toRef(model));
      preferences.setLastThinkingLevel(level);
      navigate(conversationPath(created.projectId, created.id));
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <div className="flex items-center gap-2">
      <ProjectPicker projects={projects.data} projectId={projectId} onProject={setProject} disabled={busy} />
      {cloning ? <span className="text-sm text-muted-foreground">Cloning…</span> : null}
    </div>
  );
  const toolbar = (
    <ModelThinkingPickers
      models={models.data}
      model={model ? toRef(model) : null}
      onModel={setModel}
      levels={levels}
      level={level}
      onLevel={setLevel}
      disabled={busy}
    />
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <h2 className="text-lg font-semibold">New thread</h2>
      <div className="w-full max-w-2xl">
        <Composer
          target="new"
          imagesAllowed={model?.images ?? true}
          busy={busy}
          disabled={cloning}
          footer={footer}
          toolbar={toolbar}
          onSend={start}
        />
      </div>
    </div>
  );
}

function NewThreadSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3 p-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
