import { clampThinkingLevel } from "@earendil-works/pi-ai/models";
import type { ModelRef, ThinkingLevel } from "@tau/protocol";

type ModelLookup = {
  getModel(provider: string, modelId: string): Parameters<typeof clampThinkingLevel>[0] | undefined;
};

export function clampThinkingFor(models: ModelLookup, ref: ModelRef, level: ThinkingLevel): ThinkingLevel {
  const model = models.getModel(ref.provider, ref.modelId);
  return model ? clampThinkingLevel(model, level) : level;
}

export const THINKING_GUIDANCE = [
  "Effort is your main lever: set `thinking` on every subagent from what its task needs, and keep your own model unless the task clearly needs another one.",
  "If you are unsure which model to use, use your own and change only `thinking`.",
  "`off`, `minimal` or `low`: summaries, searching, listing, mechanical edits, bulk fan-out. Fast and cheap, but shallow, so never for judgment.",
  "`medium`: ordinary implementation.",
  "`high`, `xhigh` or `max`: reviewing a plan, a hard bug, an architecture decision, anything where a wrong answer is costly. A small model on high effort can beat a big one on low.",
  "Do not just inherit your own level: yours may be wrong for the task. It is clamped to what the subagent's model supports.",
  "An explicit user instruction about the model or the effort always wins.",
].join(" ");
