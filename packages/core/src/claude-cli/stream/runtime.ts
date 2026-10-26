import type { ClaudeMcpServerStatus, ClaudeSdkPort } from "../sdk-types";
import type { Binding } from "./binding";
import type { BindingSnapshot } from "./binding-store";
import type { ClaudeCliStreamDeps } from "./claude-cli-stream";
import { createSnapshotStore } from "./snapshot-store";

/** The shared state of one streamer. */
export interface Runtime {
  readonly deps: ClaudeCliStreamDeps;
  readonly bindings: Map<string, Binding>;
  /** Bindings with a running SDK process, one-shot ones included. */
  readonly live: Set<Binding>;
  /** The last connector list the adapter's own probe read. */
  statusCache: { readonly at: number; readonly value: readonly ClaudeMcpServerStatus[] } | null;
  port(): Promise<ClaudeSdkPort>;
  notifyProcesses(): void;
  /** Restores the persisted binding for a Pi session, if any. No-op without a file. */
  restoreBinding(piSessionId: string): Promise<Binding | undefined>;
  /** Persists the binding's resume state. No-op without a file or session id. */
  persistBinding(binding: Binding): void;
  /** Drops the persisted binding. No-op without a file. */
  dropBinding(piSessionId: string): void;
  /** Resolves when every persist and drop so far reached the file, or was reported as failed. */
  flush(): Promise<void>;
}

const reportSaveFailure = (error: unknown): void =>
  console.error("tau: could not save the Claude CLI bindings", error);

export function createRuntime(deps: ClaudeCliStreamDeps): Runtime {
  let loaded: Promise<ClaudeSdkPort> | undefined;
  let announced = 0;
  const live = new Set<Binding>();
  const bindings = new Map<string, Binding>();
  const file = deps.bindingsFile;
  const store = file ? createSnapshotStore(file, deps.onPersistError ?? reportSaveFailure) : undefined;
  const restoring = new Map<string, Promise<Binding | undefined>>();
  const snapshotOf = (binding: Binding): BindingSnapshot | null => {
    if (!binding.sdkSessionId) return null;
    return {
      sdkSessionId: binding.sdkSessionId,
      checkpoints: [...binding.checkpoints],
      head: binding.head ? { ...binding.head } : null,
      created: [...binding.created],
      model: binding.model,
    };
  };
  const restoreFromSnapshot = async (piSessionId: string): Promise<Binding | undefined> => {
    const saved = await store?.find(piSessionId);
    if (!saved) return undefined;
    const { createBinding } = await import("./binding");
    const raced = bindings.get(piSessionId);
    if (raced) return raced;
    const binding = createBinding(piSessionId, saved.model);
    binding.sdkSessionId = saved.sdkSessionId;
    binding.checkpoints = [...saved.checkpoints];
    binding.head = saved.head ? { ...saved.head } : null;
    saved.created.forEach((sessionId) => {
      binding.created.add(sessionId);
    });
    bindings.set(piSessionId, binding);
    return binding;
  };
  return {
    deps,
    bindings,
    live,
    statusCache: null,
    async restoreBinding(piSessionId) {
      const known = bindings.get(piSessionId);
      if (known) return known;
      let pending = restoring.get(piSessionId);
      if (!pending) {
        pending = restoreFromSnapshot(piSessionId).finally(() => restoring.delete(piSessionId));
        restoring.set(piSessionId, pending);
      }
      return pending;
    },
    persistBinding(binding) {
      if (binding.id.startsWith("anonymous-")) return;
      store?.update((rows) => {
        const snapshot = snapshotOf(binding);
        if (!snapshot) return false;
        rows[binding.id] = snapshot;
        return true;
      });
    },
    dropBinding(piSessionId) {
      store?.update((rows) => {
        if (!(piSessionId in rows)) return false;
        delete rows[piSessionId];
        return true;
      });
    },
    flush: () => store?.flush() ?? Promise.resolve(),
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
