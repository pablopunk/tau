import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { SuggestedCodeFolder } from "@pi-everywhere/protocol";
import type { SettingsStore } from "../home/settings-store";

export interface CodeFolderDeps {
  readonly settings: SettingsStore;
  readonly defaultProjectsFolder: string;
  readonly homeDirectory: string;
}

const CANDIDATE_NAMES = ["src", "code", "projects", "dev"];

const isDirectory = (path: string) =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );

async function firstExistingDirectory(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) if (await isDirectory(path)) return path;
  return undefined;
}

export async function suggestCodeFolder(deps: CodeFolderDeps): Promise<SuggestedCodeFolder> {
  const { projectsFolder } = await deps.settings.get();
  if (projectsFolder !== deps.defaultProjectsFolder) return null;
  const path = await firstExistingDirectory(CANDIDATE_NAMES.map((name) => join(deps.homeDirectory, name)));
  return path === undefined ? null : { path };
}
