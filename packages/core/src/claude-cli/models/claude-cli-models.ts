import type { Api, Model } from "@earendil-works/pi-ai";
import type { ClaudeSdkLoader } from "../sdk-types";

/** Owner A. Frozen signature; the body is a placeholder with no models. */
export interface ClaudeCliModelsDeps {
  readonly sdk: ClaudeSdkLoader;
  /** True only while the detector state is `ready`. */
  readonly isReady: () => boolean;
  readonly onChange: () => void;
}

export interface ClaudeCliModels {
  /** The list as of the last refresh. Empty before it or when not ready. Never blocks, never throws. */
  getModels(): readonly Model<Api>[];
  /** `supportedModels()`; keeps the old list on failure. */
  refresh(): Promise<void>;
  /** The last `modelUsage.contextWindow` the SDK reported, used for the next `getModels()`. */
  noteContextWindow(modelValue: string, contextWindow: number): void;
}

export function createClaudeCliModels(_deps: ClaudeCliModelsDeps): ClaudeCliModels {
  return { getModels: () => [], refresh: async () => undefined, noteContextWindow: () => undefined };
}
