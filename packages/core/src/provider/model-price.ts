import type { ModelInfo } from "@tau/protocol";

export const KNOWN_FREE_IDS: readonly string[] = ["big-pickle"];

export interface CatalogCost {
  readonly input: number;
  readonly output: number;
}

export type ModelPrice = NonNullable<ModelInfo["cost"]>;

export const isFreeId = (id: string): boolean =>
  id.endsWith(":free") || id.endsWith("-free") || KNOWN_FREE_IDS.includes(id);

const isZero = (cost: CatalogCost) => cost.input === 0 && cost.output === 0;

export function priceOf(id: string, cost: CatalogCost | undefined): ModelPrice | undefined {
  if (!cost) return undefined;
  if (!isZero(cost)) return { input: cost.input, output: cost.output };
  return isFreeId(id) ? { input: 0, output: 0 } : undefined;
}
