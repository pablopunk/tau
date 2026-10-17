import { mkdir } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { clampThinkingLevel } from "@earendil-works/pi-ai/models";
import { AppError, type Core, type ModelRef, type ThinkingLevel } from "@pi-everywhere/protocol";
import { expandHome } from "./fs/expand-home";
import { type CodeFolderDeps, suggestCodeFolder } from "./github/code-folder";
import type { SettingsStore } from "./home/settings-store";
import type { ProviderService } from "./provider/provider-service";
import { resolveProjectFolder } from "./resolve-project-folder";

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
}): Core["settings"] {
  const { settings, provider, codeFolder, onProjectsFolderChanged } = deps;
  const requireListedModel = async (ref: ModelRef) => {
    if (!(await provider.isConfigured())) throw new AppError("no_provider", "Connect a provider first.");
    if (!(await provider.lists(ref))) {
      throw new AppError("invalid_request", "This model is not available from your connected providers.");
    }
  };
  const clampForModel = (ref: ModelRef, level: ThinkingLevel | null): ThinkingLevel | null => {
    const model = provider.models.getModel(ref.provider, ref.modelId);
    return level !== null && model ? clampThinkingLevel(model, level) : level;
  };
  return {
    get: () => settings.get(),
    suggestedCodeFolder: () => suggestCodeFolder(codeFolder),
    setMessageMode: (mode) => settings.setMessageMode(mode),
    setWorkspaceDefault: (mode) => settings.setWorkspaceDefault(mode),
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
    async setProjectsFolder(path) {
      await settings.setProjectsFolder(await createFolder(path));
      onProjectsFolderChanged();
    },
  };
}
