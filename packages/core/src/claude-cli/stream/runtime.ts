import type { ClaudeSdkPort } from "../sdk-types";
import type { Binding } from "./binding";
import type { ClaudeCliStreamDeps } from "./claude-cli-stream";

/** The shared state of one streamer. */
export interface Runtime {
  readonly deps: ClaudeCliStreamDeps;
  readonly bindings: Map<string, Binding>;
  /** Bindings with a running SDK process, one-shot ones included. */
  readonly live: Set<Binding>;
  port(): Promise<ClaudeSdkPort>;
  notifyProcesses(): void;
}

export function createRuntime(deps: ClaudeCliStreamDeps): Runtime {
  let loaded: Promise<ClaudeSdkPort> | undefined;
  let announced = 0;
  const live = new Set<Binding>();
  return {
    deps,
    bindings: new Map(),
    live,
    port() {
      loaded ??= deps.sdk().catch((error: unknown) => {
        loaded = undefined;
        throw error;
      });
      return loaded;
    },
    notifyProcesses() {
      if (announced === live.size) return;
      announced = live.size;
      deps.onProcessCount(announced);
    },
  };
}
