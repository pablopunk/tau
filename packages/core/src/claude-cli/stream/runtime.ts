import type { ClaudeMcpServerStatus, ClaudeSdkPort } from "../sdk-types";
import type { Binding } from "./binding";
import { loadBindingSnapshots, saveBindingSnapshots, type BindingSnapshot } from "./binding-store";
import type { ClaudeCliStreamDeps } from "./claude-cli-stream";

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
}

export function createRuntime(deps: ClaudeCliStreamDeps): Runtime {
  let loaded: Promise<ClaudeSdkPort> | undefined;
  let announced = 0;
  const live = new Set<Binding>();
  const bindings = new Map<string, Binding>();
  const file = deps.bindingsFile;
  let snapshots: Record<string, BindingSnapshot> | undefined;
  const ensureSnapshots = async (): Promise<Record<string, BindingSnapshot>> => {
    if (snapshots) return snapshots;
    snapshots = file ? await loadBindingSnapshots(file) : {};
    return snapshots;
  };
  // Best-effort: a failing write must never fail a turn, so saves are fire-and-forget.
  const save = () => {
    if (!file || !snapshots) return;
    void saveBindingSnapshots(file, snapshots).catch(() => undefined);
  };
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
  return {
    deps,
    bindings,
    live,
    statusCache: null,
    async restoreBinding(piSessionId) {
      const known = bindings.get(piSessionId);
      if (known) return known;
      const saved = (await ensureSnapshots())[piSessionId];
      if (!saved) return undefined;
      const { createBinding } = await import("./binding");
      const binding = createBinding(piSessionId, saved.model);
      binding.sdkSessionId = saved.sdkSessionId;
      binding.checkpoints = [...saved.checkpoints];
      binding.head = saved.head ? { ...saved.head } : null;
      binding.created = new Set(saved.created);
      bindings.set(piSessionId, binding);
      return binding;
    },
    persistBinding(binding) {
      if (!file || binding.id.startsWith("anonymous-")) return;
      void ensureSnapshots().then((all) => {
        const snapshot = snapshotOf(binding);
        if (!snapshot) return;
        all[binding.id] = snapshot;
        save();
      });
    },
    dropBinding(piSessionId) {
      if (!file) return;
      void ensureSnapshots().then((all) => {
        if (!(piSessionId in all)) return;
        delete all[piSessionId];
        save();
      });
    },
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
