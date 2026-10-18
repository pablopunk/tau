import {
  type Api,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ClaudeCliClock } from "../clock";
import type { PlanUsage } from "../plan-usage";
import type { ClaudeSdkLoader } from "../sdk-types";

/** Owner B. Frozen signature; the body is a placeholder that ends every stream with an error. */
export interface ClaudeCliStreamDeps {
  readonly sdk: ClaudeSdkLoader;
  readonly planUsage: PlanUsage;
  readonly clock: ClaudeCliClock;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Called with `modelUsage.contextWindow` for a model value. */
  readonly noteContextWindow: (modelValue: string, contextWindow: number) => void;
  /** Called when the detector must check again (an auth error). */
  readonly onAuthError: () => void;
  /** The number of live SDK processes changed. */
  readonly onProcessCount: (count: number) => void;
}

export interface ClaudeCliStreamer {
  streamSimple(
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
  /** Archive and delete: close the query of a Pi session at once. */
  closeThread(piSessionId: string): Promise<void>;
  /** Shutdown. */
  closeAll(): Promise<void>;
  processCount(): number;
}

const NOT_BUILT_YET = "The Claude CLI adapter is not built yet.";

export function createClaudeCliStream(_deps: ClaudeCliStreamDeps): ClaudeCliStreamer {
  return {
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      const message = {
        role: "assistant" as const,
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "error" as const,
        errorMessage: NOT_BUILT_YET,
        timestamp: Date.now(),
      };
      queueMicrotask(() => stream.push({ type: "error", reason: "error", error: message }));
      return stream;
    },
    closeThread: async () => undefined,
    closeAll: async () => undefined,
    processCount: () => 0,
  };
}
