import type { Core } from "@tau/protocol";
import type { AllowList } from "./allow-list";
import type { Session } from "./session";
import type { TunnelTags } from "./tunnel-tags";

/** Frozen in Phase 0. `hostnames()` is read per request: the tunnel hostname changes while the server runs. */
export interface GuardContext {
  readonly session: Session;
  readonly access: Core["access"];
  readonly tunnel: TunnelTags;
  hostnames(): AllowList;
}
