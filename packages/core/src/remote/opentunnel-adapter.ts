import { create, type OpenTunnelPromiseClient, OpenTunnelStorage } from "@opentunnel/client";
import { AppError, REMOTE_OFF, type RemoteStatus } from "@tau/protocol";
import type { RemoteAdapter, RemoteAdapterDeps } from "./ports";

/** The only file that may import `@opentunnel/client` (Biome `noRestrictedImports`). */

/**
 * The SDK's file store rooted at `<home>/remote` (`<home>/remote/opentunnel/<profile>/…`, no `~/.local`), so a
 * scratch home never touches the user's own tunnel. Pin: it writes nothing outside the given directory.
 */
export function createTunnelClient(directory: string): OpenTunnelPromiseClient {
  const env = { XDG_DATA_HOME: directory, XDG_CONFIG_HOME: directory, XDG_STATE_HOME: directory };
  return create({ store: OpenTunnelStorage.xdg({ env, home: directory }) });
}

const notYet = () => new AppError("internal", "Remote access is not implemented yet.");

/** Phase 0 stub. Owner B: `ensure`, then `connect({ routes: { "@": { target, proxyProtocol: "v2" } } })`, `remove`, `recreate`. */
export function createOpenTunnelAdapter(deps: RemoteAdapterDeps): RemoteAdapter {
  const client = createTunnelClient(deps.directory);
  const status: RemoteStatus = REMOTE_OFF;
  return {
    status: () => status,
    enable: async () => {
      throw notYet();
    },
    disable: async () => status,
    recreate: async () => {
      throw notYet();
    },
    onStatus: () => () => undefined,
    close: () => client.dispose(),
  };
}
