import type { ClaudeConnectorSettings } from "@tau/protocol";
import type { ClaudeMcpServerStatus } from "../sdk-types";

export interface ChosenServers {
  /** Status names (`claude.ai Linear`) the user switched on and that are connected. */
  readonly names: readonly string[];
  /** `allowedTools` for the query: the `tau` glob, the read-only tools of the chosen servers, the always-allowed tools. */
  readonly allowedTools: readonly string[];
}

/** Owner A implements it. */
export function chooseServers(
  _settings: ClaudeConnectorSettings,
  _status: readonly ClaudeMcpServerStatus[],
): ChosenServers {
  return { names: [], allowedTools: [] };
}
