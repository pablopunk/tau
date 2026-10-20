import type { ModelInfo, ModelRef } from "@tau/protocol";
import { naturalCompare } from "../../agents/model-alias";
import { type Band, bandsOf } from "./agent-model-bands";

export const MODEL_LIST_CAP = 40;
export const FREE_LIST_CAP = 10;

export const modelName = (model: ModelRef) => `${model.provider}/${model.modelId}`;

interface Entry {
  readonly model: ModelInfo;
  readonly band: Band;
}

export interface ListMarkers {
  readonly parent: ModelRef | undefined;
  /** What the `fast` alias resolves to for this parent. */
  readonly fast: ModelRef | undefined;
}

const isFreeEntry = (entry: Entry) => entry.band === "free";

const BAND_ORDER: readonly Band[] = ["free", "light", "mid", "heavy", "unpriced"];

const sameModel = (a: ModelRef | undefined, b: ModelRef) =>
  a?.provider === b.provider && a.modelId === b.modelId;

const byIdDescending = (a: Entry, b: Entry) =>
  naturalCompare(b.model.modelId, a.model.modelId) || a.model.modelId.localeCompare(b.model.modelId);

const inBand = (entries: readonly Entry[], band: Band) =>
  entries.filter((entry) => entry.band === band).sort(byIdDescending);

function pinned(entries: readonly Entry[], markers: ListMarkers): Entry[] {
  return entries.filter(
    (entry) => sameModel(markers.parent, entry.model) || sameModel(markers.fast, entry.model),
  );
}

function fillByBand(rest: readonly Entry[], slots: number): Entry[] {
  const quota = Math.ceil(slots / 3);
  const picked: Entry[] = [];
  for (const band of ["light", "mid", "heavy"] as const) {
    const room = Math.min(quota, slots - picked.length);
    picked.push(...inBand(rest, band).slice(0, room));
  }
  const unpricedRoom = slots - picked.length;
  return [...picked, ...inBand(rest, "unpriced").slice(0, unpricedRoom)];
}

export interface Selection {
  readonly shown: readonly Entry[];
  readonly hiddenFree: number;
  readonly hidden: number;
}

export function selectModels(models: readonly ModelInfo[], markers: ListMarkers): Selection {
  const bands = bandsOf(models);
  const entries = models.map((model, index): Entry => ({ model, band: bands[index] as Band }));
  const always = pinned(entries, markers);
  const left = (list: readonly Entry[]) => entries.filter((entry) => !list.includes(entry));
  const free = inBand(left(always), "free");
  const freeShown = free.slice(0, Math.max(0, FREE_LIST_CAP - always.filter(isFreeEntry).length));
  const chosen = [...always, ...freeShown];
  const rest = left(chosen).filter((entry) => entry.band !== "free");
  const filled = fillByBand(rest, Math.max(0, MODEL_LIST_CAP - chosen.length));
  const shown = [...chosen, ...filled].sort(
    (a, b) => BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band) || byIdDescending(a, b),
  );
  return {
    shown,
    hiddenFree: free.length - freeShown.length,
    hidden: rest.length - filled.length,
  };
}

const price = (value: number) => `$${Number(value.toFixed(3))}`;

const contextOf = (tokens: number) =>
  tokens >= 1_000_000
    ? `${Number((tokens / 1_000_000).toFixed(1))}M ctx`
    : `${Math.round(tokens / 1000)}k ctx`;

function markerOf(model: ModelRef, markers: ListMarkers): string {
  const isParent = sameModel(markers.parent, model);
  const isFast = sameModel(markers.fast, model);
  if (isParent && isFast) return " (your model, fast)";
  if (isParent) return " (your model)";
  return isFast ? " (fast)" : "";
}

function priceOfEntry({ model, band }: Entry): string | undefined {
  if (band === "free" || !model.cost) return undefined;
  return `${price(model.cost.input)}/${price(model.cost.output)} per MTok`;
}

export function lineOf(entry: Entry, markers: ListMarkers): string {
  const facts = [
    entry.band,
    priceOfEntry(entry),
    contextOf(entry.model.contextWindow),
    entry.model.reasoning ? "reasoning" : "no reasoning",
  ].filter((fact) => fact !== undefined);
  return `- ${modelName(entry.model)}${markerOf(entry.model, markers)}: ${facts.join(", ")}`;
}

export function modelLines(models: readonly ModelInfo[], markers: ListMarkers): string[] {
  const { shown, hiddenFree, hidden } = selectModels(models, markers);
  const lines = shown.map((entry) => lineOf(entry, markers));
  if (hiddenFree > 0) lines.push(`- ... and ${hiddenFree} more free models`);
  if (hidden > 0) lines.push(`- ... and ${hidden} more`);
  return lines;
}
