import type { ModelInfo, ModelRef } from "@tau/protocol";
import { type ListMarkers, modelLines, modelName } from "./agent-model-lines";
import { THINKING_GUIDANCE } from "./agent-thinking";

export { MODEL_LIST_CAP, modelName } from "./agent-model-lines";

const PRICE_PROXY = "price tracks capability loosely; it is a proxy, not a benchmark";

const BILLING_CAPTION = {
  usage: "pay per token, heavier = more money per token",
  subscription: "a subscription, heavier burns your plan's usage window faster; free models burn none",
} as const;

const POLICY = [
  "Subagent models: default to your own model and vary `thinking` instead (see the effort rule below). Change the model only when the task clearly needs a different one. Go lighter (free or light) for search, summaries, mechanical edits and bulk fan-out. Go heavier than your own model when the task needs a smarter one, such as reviewing a plan, a hard bug, or an architecture decision, even if you are a fast model yourself: delegate that one piece, not everything. If you are unsure, use your own model.",
  "If your own band is unpriced, you cannot compare: keep your own model unless the task clearly needs a smarter one. If it is free, nothing is lighter. If every model shows mid, the bands say nothing: read the prices. N workers multiply spend or quota by N, and a heavier model costs more per worker: use few heavy workers.",
  "There is no latency data: lower `thinking` is the main speed lever, a lighter model the second.",
];

const sameModel = (a: ModelRef | undefined, b: ModelRef) =>
  a?.provider === b.provider && a.modelId === b.modelId;

function fastTarget(parent: ModelRef | undefined, fast: ModelRef | undefined): ModelRef | undefined {
  return parent && fast?.provider === parent.provider ? fast : parent;
}

function aliasLine(parent: ModelRef | undefined, target: ModelRef | undefined): string {
  const fast = target && !sameModel(parent, target) ? modelName(target) : "your own model";
  return `Aliases: \`inherit\` = your model; \`fast\` = ${fast}.`;
}

function headerLine(parent: ModelRef | undefined, own: readonly ModelInfo[]): string {
  const billing = own.find((model) => model.billing)?.billing;
  const provider = parent?.provider ?? "unknown";
  const caption = billing ? `${BILLING_CAPTION[billing]}; ${PRICE_PROXY}` : PRICE_PROXY;
  return `Connected models (provider ${provider}, ${caption}). Line format: model: band, $in/$out per MTok, context, reasoning.`;
}

export function modelsGuidance(
  models: readonly ModelInfo[],
  parent: ModelRef | undefined,
  fast?: ModelRef,
): string {
  const own = parent ? models.filter((model) => model.provider === parent.provider) : models;
  const target = fastTarget(parent, fast);
  const markers: ListMarkers = { parent, fast: target };
  return [
    ...POLICY,
    `Subagent effort: ${THINKING_GUIDANCE}`,
    headerLine(parent, own),
    aliasLine(parent, target),
    ...modelLines(own, markers),
  ].join("\n");
}
