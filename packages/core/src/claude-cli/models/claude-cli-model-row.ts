import type { Api, Model } from "@earendil-works/pi-ai";
import type { ClaudeModelOption } from "../sdk-types";

export const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 32_000;

type Level = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type LevelMap = Partial<Record<Level, string | null>>;
type CatalogModel = Pick<Model<Api>, "id" | "contextWindow" | "maxTokens" | "input">;

export interface RowSources {
  readonly catalog: (resolvedModel: string) => CatalogModel | undefined;
  readonly notedContextWindow: (value: string) => number | undefined;
}

function thinkingLevelMapOf(option: ClaudeModelOption): LevelMap {
  const supports = (level: string) => option.supportedEffortLevels.some((effort) => effort === level);
  const map: LevelMap = {};
  if (!option.supportsThinkingOff) map.off = null;
  if (!supports("medium")) map.medium = null;
  if (!supports("high")) map.high = null;
  if (supports("xhigh")) map.xhigh = "xhigh";
  return map;
}

export function modelRowOf(option: ClaudeModelOption, sources: RowSources): Model<Api> {
  const catalog = option.resolvedModel ? sources.catalog(option.resolvedModel) : undefined;
  return {
    id: option.value,
    name: option.displayName,
    api: "claude-cli",
    provider: "claude-cli",
    baseUrl: "",
    input: catalog?.input ?? ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: option.supportedEffortLevels.length > 0,
    thinkingLevelMap: thinkingLevelMapOf(option),
    contextWindow:
      sources.notedContextWindow(option.value) ?? catalog?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: catalog?.maxTokens ?? DEFAULT_MAX_TOKENS,
  } as Model<Api>;
}
