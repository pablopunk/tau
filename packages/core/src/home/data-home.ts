import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PRIVATE_DIRECTORY_MODE } from "./atomic-write";

export interface DataHome {
  readonly root: string;
  readonly agentDatabase: string;
  readonly settingsFile: string;
  readonly credentialsFile: string;
  readonly lockFile: string;
  readonly iconsDirectory: string;
}

export async function openDataHome(root: string): Promise<DataHome> {
  await mkdir(root, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await chmod(root, PRIVATE_DIRECTORY_MODE);
  return {
    root,
    agentDatabase: join(root, "agent.sqlite"),
    settingsFile: join(root, "settings.json"),
    credentialsFile: join(root, "credentials.json"),
    lockFile: join(root, "lock"),
    iconsDirectory: join(root, "icons"),
  };
}
