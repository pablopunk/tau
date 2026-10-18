import type { ClaudeEffort, ClaudeModelOption } from "../sdk-types";

const STANDARD_EFFORT: readonly ClaudeEffort[] = ["low", "medium", "high", "xhigh"];
const NO_EFFORT: readonly ClaudeEffort[] = [];

const row = (
  value: string,
  resolvedModel: string,
  displayName: string,
  supportedEffortLevels: readonly ClaudeEffort[] = STANDARD_EFFORT,
): ClaudeModelOption => ({
  value,
  resolvedModel,
  displayName,
  description: `${displayName} (fake)`,
  supportedEffortLevels,
  supportsThinkingOff: supportedEffortLevels.length === 0 || value === "haiku",
});

/** The 14 rows the spike saw from `supportedModels()` on CLI 2.1.302. */
export const FAKE_CLAUDE_MODELS: readonly ClaudeModelOption[] = [
  row("default", "claude-opus-5-5", "Default (Opus 5.5)"),
  row("opus", "claude-opus-5-5", "Opus 5.5"),
  row("fable", "claude-fable-5-1", "Fable 5.1"),
  row("sonnet", "claude-sonnet-5-5", "Sonnet 5.5"),
  row("haiku", "claude-haiku-5-5", "Haiku 5.5", NO_EFFORT),
  row("claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001", "Haiku 4.5", NO_EFFORT),
  row("claude-sonnet-5", "claude-sonnet-5", "Sonnet 5"),
  row("claude-opus-5", "claude-opus-5", "Opus 5"),
  row("claude-fable-5", "claude-fable-5", "Fable 5"),
  row("claude-opus-4-8", "claude-opus-4-8", "Opus 4.8"),
  row("claude-opus-4-7", "claude-opus-4-7", "Opus 4.7"),
  row("claude-opus-4-6", "claude-opus-4-6", "Opus 4.6"),
  row("claude-sonnet-4-6", "claude-sonnet-4-6", "Sonnet 4.6"),
  row("claude-mythos-5-1", "claude-mythos-5-1", "Mythos 5.1"),
];
