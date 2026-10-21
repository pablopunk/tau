import { mkdir } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { clampThinkingLevel } from "@earendil-works/pi-ai/models";
import {
  AppError,
  type CompactionSettings,
  CompactionSettingsSchema,
  type Core,
  type ModelRef,
  type ProviderId,
  type ResourceActivity,
  type ResourceSettings,
  ResourceSettingsSchema,
  type ResourceSupport,
  type ThinkingLevel,
  type VoiceModelSetting,
  VoiceModelSettingSchema,
} from "@tau/protocol";
import { Value } from "typebox/value";
import { expandHome } from "./fs/expand-home";
import { type CodeFolderDeps, suggestCodeFolder } from "./github/code-folder";
import type { SettingsStore } from "./home/settings-store";
import type { ProviderService } from "./provider/provider-service";
import { listProviderOptions } from "./provider/voice-models";
import { resolveProjectFolder } from "./resolve-project-folder";

/** Stub until the governor probes the host. */
const UNSUPPORTED_RESOURCES: ResourceSupport = {
  platform: "other",
  memoryEnforcement: "none",
  prioritySupported: false,
  sameCgroupOnly: false,
  note: "Resource control is not available yet.",
};

const NOT_A_FOLDER = new AppError("not_a_directory", "This path is not a folder.");

async function createFolder(typedPath: string): Promise<string> {
  const path = expandHome(typedPath);
  if (!isAbsolute(path)) throw new AppError("invalid_request", "The folder path must be absolute.");
  await mkdir(path, { recursive: true }).catch((error: NodeJS.ErrnoException) => {
    throw error.code === "EEXIST" || error.code === "ENOTDIR" ? NOT_A_FOLDER : error;
  });
  return resolveProjectFolder(path);
}

export function createSettingsApi(deps: {
  settings: SettingsStore;
  provider: ProviderService;
  codeFolder: CodeFolderDeps;
  onProjectsFolderChanged: () => void;
  onClaudeConnectorsChanged?: () => Promise<void>;
  /** Receives the stored value after `setResources`; the core wires it to the governor. */
  onResourcesChanged?: (value: ResourceSettings) => void;
  /** The governor's side of the resource calls; without it the Phase 1 stubs answer. */
  resources?: {
    support(): Promise<ResourceSupport>;
    activity(): Promise<ResourceActivity>;
    stop(entryId: string): Promise<void>;
  };
}): Core["settings"] {
  const {
    settings,
    provider,
    codeFolder,
    onProjectsFolderChanged,
    onClaudeConnectorsChanged,
    onResourcesChanged,
    resources,
  } = deps;
  const requireListedModel = async (ref: ModelRef) => {
    if (!(await provider.isConfigured())) throw new AppError("no_provider", "Connect a provider first.");
    if (!(await provider.lists(ref))) {
      throw new AppError("invalid_request", "This model is not available from your connected providers.");
    }
  };
  // Like `requireListedModel` but against the live voice catalog: STT ids are
  // not chat models, so `provider.lists()` would reject them all.
  const requireVoiceModel = async (setting: { provider: string; modelId: string }) => {
    if (!(await provider.isConfigured())) throw new AppError("no_provider", "Connect a provider first.");
    const row = (await listProviderOptions(provider)).find(
      (candidate) => candidate.provider === setting.provider,
    );
    if (!row) {
      throw new AppError("invalid_request", "This model is not available from your connected providers.");
    }
    if (row.error !== undefined) {
      throw new AppError("invalid_request", "Could not load the speech model list from OpenRouter.");
    }
    if (!row.models.some((model) => model.modelId === setting.modelId)) {
      throw new AppError("invalid_request", "This model is not available from your connected providers.");
    }
  };
  const hasDecisionBackend = async (backend: CompactionSettings["backend"]): Promise<boolean> => {
    const wanted: readonly ProviderId[] = backend === "auto" ? ["typesafe", "openai"] : [backend];
    const connected = new Set(
      (await provider.list()).filter((info) => info.connection !== null).map((info) => info.id),
    );
    return wanted.some((id) => connected.has(id));
  };
  const clampForModel = (ref: ModelRef, level: ThinkingLevel | null): ThinkingLevel | null => {
    const model = provider.models.getModel(ref.provider, ref.modelId);
    return level !== null && model ? clampThinkingLevel(model, level) : level;
  };
  return {
    get: () => settings.get(),
    suggestedCodeFolder: () => suggestCodeFolder(codeFolder),
    setMessageMode: (mode) => settings.setMessageMode(mode),
    setSetupSkipped: (skipped) => settings.setSetupSkipped(skipped),
    setWorkspaceDefault: (mode) => settings.setWorkspaceDefault(mode),
    async setClaudeConnectors(value) {
      await settings.setClaudeConnectors(value);
      await onClaudeConnectorsChanged?.();
    },
    async setResources(value) {
      if (!Value.Check(ResourceSettingsSchema, value)) {
        throw new AppError("invalid_request", "Each scope runs Off, Balanced or Background.");
      }
      await settings.setResources(value);
      onResourcesChanged?.(value);
    },
    async setCompaction(value: CompactionSettings) {
      if (!Value.Check(CompactionSettingsSchema, value)) {
        throw new AppError("invalid_request", "Compaction mode must be summary or fast.");
      }
      if (value.mode === "fast" && !(await hasDecisionBackend(value.backend))) {
        throw new AppError(
          "invalid_request",
          "Connect TypeSafe, or OpenAI with decisions access, to enable fast compaction.",
        );
      }
      await settings.setCompaction(value);
    },
    resourceSupport: async () => (resources ? resources.support() : UNSUPPORTED_RESOURCES),
    resourceActivity: async () => (resources ? resources.activity() : { holders: [], waiting: [] }),
    async stopResourceCommand(entryId) {
      if (resources) return resources.stop(entryId);
      throw new AppError("not_found", `No resource command ${entryId}`);
    },
    async setDefaultModel(ref) {
      await requireListedModel(ref);
      await settings.setDefaultModel(ref, clampForModel(ref, (await settings.get()).defaultThinkingLevel));
    },
    async setDefaultThinkingLevel(level) {
      const { defaultModel } = await settings.get();
      if (!defaultModel) throw new AppError("no_default_model", "Choose a default model first.");
      await settings.setDefaultThinkingLevel(clampForModel(defaultModel, level));
    },
    async setFastModel(ref) {
      if (ref !== null) await requireListedModel(ref);
      await settings.setFastModel(ref, ref && clampForModel(ref, (await settings.get()).fastThinkingLevel));
    },
    async setFastThinkingLevel(level) {
      const { fastModel } = await settings.get();
      if (!fastModel) throw new AppError("invalid_request", "Choose a fast model first.");
      await settings.setFastThinkingLevel(clampForModel(fastModel, level));
    },
    async setVoiceModel(setting: VoiceModelSetting) {
      if (!Value.Check(VoiceModelSettingSchema, setting)) {
        throw new AppError("invalid_request", "The voice setting is invalid.");
      }
      // The local flavor is always accepted; availability surfaces via `voice.options()`.
      if (setting !== null && setting.kind === "provider") await requireVoiceModel(setting);
      await settings.setVoiceModel(setting);
    },
    async setProjectsFolder(path) {
      await settings.setProjectsFolder(await createFolder(path));
      onProjectsFolderChanged();
    },
  };
}
