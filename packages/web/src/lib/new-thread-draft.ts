import type { ModelRef, ThinkingLevel, WorkspaceMode } from "@tau/protocol";

export interface NewThreadDraft {
  projectId: string | null;
  model: ModelRef | null;
  thinkingLevel: ThinkingLevel | null;
  workspace: WorkspaceMode | null;
}

const KEY = "tau:new-thread-draft";

const EMPTY: NewThreadDraft = { projectId: null, model: null, thinkingLevel: null, workspace: null };

const THINKING_LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const WORKSPACES: readonly string[] = ["worktree", "checkout"];

function isModelRef(value: unknown): value is ModelRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ModelRef).provider === "string" &&
    typeof (value as ModelRef).modelId === "string"
  );
}

function asDraft(value: unknown): NewThreadDraft {
  if (typeof value !== "object" || value === null) return EMPTY;
  const record = value as Record<string, unknown>;
  return {
    projectId: typeof record.projectId === "string" ? record.projectId : null,
    model: isModelRef(record.model) ? { provider: record.model.provider, modelId: record.model.modelId } : null,
    thinkingLevel:
      typeof record.thinkingLevel === "string" && THINKING_LEVELS.includes(record.thinkingLevel)
        ? (record.thinkingLevel as ThinkingLevel)
        : null,
    workspace:
      typeof record.workspace === "string" && WORKSPACES.includes(record.workspace)
        ? (record.workspace as WorkspaceMode)
        : null,
  };
}

export function loadNewThreadDraft(): NewThreadDraft {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    return asDraft(JSON.parse(raw) as unknown);
  } catch {
    return EMPTY;
  }
}

export function saveNewThreadDraft(draft: NewThreadDraft): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable or full: the draft just does not persist.
  }
}

export function clearNewThreadDraft(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
