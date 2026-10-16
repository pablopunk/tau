import type { SuggestedCodeFolder } from "@pi-everywhere/protocol";
import type { SettingsStore } from "../home/settings-store";

export interface CodeFolderDeps {
  readonly settings: SettingsStore;
  readonly defaultProjectsFolder: string;
  readonly homeDirectory: string;
}

export async function suggestCodeFolder(_deps: CodeFolderDeps): Promise<SuggestedCodeFolder> {
  return null;
}
