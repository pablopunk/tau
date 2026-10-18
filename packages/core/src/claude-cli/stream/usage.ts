import type { Usage } from "@earendil-works/pi-ai";

export interface RawUsage {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
}

export const zeroUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const known = (value: number | null | undefined, fallback: number): number =>
  typeof value === "number" ? value : fallback;

/** Later usage of the same API message wins field by field. Plan usage is not money: cost stays 0. */
export function mergeUsage(usage: Usage, raw: RawUsage | undefined): void {
  if (!raw) return;
  usage.input = known(raw.input_tokens, usage.input);
  usage.output = known(raw.output_tokens, usage.output);
  usage.cacheRead = known(raw.cache_read_input_tokens, usage.cacheRead);
  usage.cacheWrite = known(raw.cache_creation_input_tokens, usage.cacheWrite);
  usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}
