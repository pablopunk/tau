import type { ClaudeConnectorSettings } from "@tau/protocol";
import type { Runtime } from "./runtime";

/** The user's connector choice; a failing settings read counts as "no connector". */
export const connectorSettingsOf = (rt: Runtime): Promise<ClaudeConnectorSettings | null> =>
  rt.deps.connectorSettings?.().catch(() => null) ?? Promise.resolve(null);
