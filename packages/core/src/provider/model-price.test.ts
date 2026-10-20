import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { describe, expect, it } from "vitest";
import { toModelInfo } from "./model-list";
import { isFreeId, KNOWN_FREE_IDS, priceOf } from "./model-price";

const zero = { input: 0, output: 0 };

describe("free rule", () => {
  it("accepts :free, -free and the known ids", () => {
    for (const id of ["google/gemma-4-26b-a4b-it:free", "step-5-preview-free", "big-pickle"]) {
      expect(priceOf(id, zero)).toEqual(zero);
    }
  });

  it("leaves routers, gemma and zero-priced rows unpriced", () => {
    for (const id of ["auto", "openrouter/free", "fusion", "gemma-3-27b-it", "faux-text"]) {
      expect(isFreeId(id)).toBe(false);
      expect(priceOf(id, zero)).toBeUndefined();
    }
  });

  it("emits a positive catalog price and nothing without a cost", () => {
    expect(priceOf("claude", { input: 3, output: 15 })).toEqual({ input: 3, output: 15 });
    expect(priceOf("claude", undefined)).toBeUndefined();
  });

  it("keeps every known free id in pi's opencode catalog", () => {
    const ids = [...opencodeProvider().getModels(), ...opencodeGoProvider().getModels()].map((m) => m.id);
    for (const id of KNOWN_FREE_IDS) expect(ids).toContain(id);
  });
});

describe("toModelInfo", () => {
  const model = {
    provider: "claude-cli",
    id: "sonnet",
    name: "Sonnet",
    contextWindow: 200_000,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  } as unknown as Parameters<typeof toModelInfo>[0];

  it("takes the override price and the ref's billing", () => {
    const info = toModelInfo(
      model,
      { label: "Claude CLI", billing: "subscription" },
      { input: 3, output: 15 },
    );
    expect(info).toMatchObject({ billing: "subscription", cost: { input: 3, output: 15 } });
  });

  it("omits cost for a zero-priced row without override", () => {
    const info = toModelInfo(model, { label: "Claude CLI", billing: "subscription" });
    expect(info.cost).toBeUndefined();
  });
});
