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
  readonly devicesFile: string;
  /** `<home>/node.json`: this node's Ed25519 identity (0600). */
  readonly identityFile: string;
  /** `<home>/peers.json`: the peers this node dials (0600). */
  readonly peersFile: string;
  readonly expelledFile: string;
  /** The custom OpenTunnel store, never XDG. */
  readonly remoteDirectory: string;
  readonly nodesDirectory: string;
  readonly startsFile: string;
  readonly lastExitFile: string;
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
    devicesFile: join(root, "devices.json"),
    identityFile: join(root, "node.json"),
    peersFile: join(root, "peers.json"),
    expelledFile: join(root, "expelled.json"),
    remoteDirectory: join(root, "remote"),
    // `machines/` (0.1.x) is renamed to `nodes/` at start by `migrateSummaryDirectory`.
    nodesDirectory: join(root, "nodes"),
    startsFile: join(root, "starts.json"),
    lastExitFile: join(root, "last-exit.json"),
  };
}
