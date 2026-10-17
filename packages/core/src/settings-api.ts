import { mkdir } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { AppError, type Core, type ModelRef } from "@pi-everywhere/protocol";
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
      throw new AppError("invalid_request", "This model is not available for your API key.");
    }
  };
  return {
    get: () => settings.get(),
    suggestedCodeFolder: () => suggestCodeFolder(codeFolder),
    async setDefaultModel(ref) {
      await requireListedModel(ref);
      await settings.setDefaultModel(ref);
    },
    async setFastModel(ref) {
      if (ref !== null) await requireListedModel(ref);
      await settings.setFastModel(ref);
    },
    async setProjectsFolder(path) {
      await settings.setProjectsFolder(await createFolder(path));
      onProjectsFolderChanged();
    },
  };
}
