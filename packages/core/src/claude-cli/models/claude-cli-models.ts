import type { Api, Model } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import type { ClaudeModelOption, ClaudeSdkLoader } from "../sdk-types";
import { modelRowOf } from "./claude-cli-model-row";

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

const NO_MODELS: readonly Model<Api>[] = [];

const catalogLookup = () => {
  const catalog = anthropicProvider().getModels();
  return (resolvedModel: string) => catalog.find((model) => model.id === resolvedModel);
};

export function createClaudeCliModels(deps: ClaudeCliModelsDeps): ClaudeCliModels {
  let options: readonly ClaudeModelOption[] | null = null;
  let loading: Promise<void> | null = null;
  const noted = new Map<string, number>();

  function build(): readonly Model<Api>[] {
    if (!options) return NO_MODELS;
    const catalog = catalogLookup();
    return options.map((option) =>
      modelRowOf(option, { catalog, notedContextWindow: (value) => noted.get(value) }),
    );
  }

  async function load(): Promise<void> {
    try {
      const loaded = await (await deps.sdk()).supportedModels();
      options = loaded;
      deps.onChange();
    } catch {
      return;
    }
  }

  function refresh(): Promise<void> {
    if (!deps.isReady()) return Promise.resolve();
    loading ??= load().finally(() => {
      loading = null;
    });
    return loading;
  }

  return {
    getModels() {
      try {
        if (!deps.isReady()) return NO_MODELS;
        if (!options) void refresh();
        return build();
      } catch {
        return NO_MODELS;
      }
    },
    refresh,
    noteContextWindow: (value, contextWindow) => void noted.set(value, contextWindow),
  };
}
