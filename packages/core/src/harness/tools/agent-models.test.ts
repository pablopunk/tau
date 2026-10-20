import type { ModelInfo } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { MODEL_LIST_CAP, modelsGuidance } from "./agent-models";

type Cost = ModelInfo["cost"];

const model = (provider: string, modelId: string, cost?: Cost, billing: ModelInfo["billing"] = "usage") => ({
  provider,
  modelId,
  name: modelId,
  contextWindow: 200_000,
  reasoning: true,
  images: false,
  thinkingLevels: ["off" as const],
  providerName: provider,
  billing,
  ...(cost && { cost }),
});

const price = (input: number, output = input * 5) => ({ input, output });
const ref = (provider: string, modelId: string) => ({ provider, modelId });
const linesOf = (text: string) => text.split("\n").filter((line) => line.startsWith("- "));

const anthropic = [
  model("anthropic", "claude-opus-5", price(15)),
  model("anthropic", "claude-sonnet-5", price(3)),
  model("anthropic", "claude-haiku-5", price(1)),
  model("anthropic", "claude-haiku-4", price(1)),
];

describe("modelsGuidance", () => {
  it("describes an Anthropic-sized list with bands, prices and markers", () => {
    const text = modelsGuidance(
      anthropic,
      ref("anthropic", "claude-sonnet-5"),
      ref("anthropic", "claude-haiku-5"),
    );
    expect(text).toContain("provider anthropic, pay per token, heavier = more money per token");
    expect(text).toContain("a proxy, not a benchmark".replace("a proxy", "it is a proxy"));
    expect(text).toContain(
      "- anthropic/claude-sonnet-5 (your model): mid, $3/$15 per MTok, 200k ctx, reasoning",
    );
    expect(text).toContain("- anthropic/claude-haiku-5 (fast): light, $1/$5 per MTok");
    expect(text).toContain("- anthropic/claude-opus-5: heavy, $15/$75 per MTok");
    expect(text).toContain("`fast` = anthropic/claude-haiku-5");
  });

  it("labels a Go-sized subscription list and keeps free models light on the plan", () => {
    const go = [
      ...["a-free", "b-free"].map((id) => model("opencode-go", id, price(0, 0), "subscription")),
      ...[1, 1, 5, 5, 20, 20].map((p, i) => model("opencode-go", `m${i}`, price(p), "subscription")),
    ];
    const text = modelsGuidance(go, ref("opencode-go", "m2"));
    expect(text).toContain("subscription, heavier burns your plan's usage window faster");
    expect(linesOf(text)[0]).toBe("- opencode-go/b-free: free, 200k ctx, reasoning");
    expect(text).toContain("- opencode-go/m2 (your model, fast): mid,");
  });

  it("caps an OpenRouter-sized list and says how much is hidden", () => {
    const free = Array.from({ length: 25 }, (_, i) => model("openrouter", `f${i}:free`, price(0, 0)));
    const paid = Array.from({ length: 90 }, (_, i) =>
      model("openrouter", `vendor/p${i}`, price(1 + (i % 30))),
    );
    const text = modelsGuidance([...free, ...paid], ref("openrouter", "vendor/p3"));
    const lines = linesOf(text);
    expect(lines.filter((line) => line.includes(": free,"))).toHaveLength(10);
    expect(text).toContain("- ... and 15 more free models");
    expect(lines.filter((line) => !line.includes("..."))).toHaveLength(MODEL_LIST_CAP);
    expect(lines.at(-1)).toMatch(/^- \.\.\. and \d+ more$/);
    expect(text).toContain("(your model, fast)");
  });

  it("is deterministic whatever the input order", () => {
    const parent = ref("anthropic", "claude-sonnet-5");
    expect(modelsGuidance([...anthropic].reverse(), parent)).toBe(modelsGuidance(anthropic, parent));
  });

  it("lists claude-cli models as a subscription with list prices", () => {
    const cli = [
      model("claude-cli", "opus", price(15), "subscription"),
      model("claude-cli", "sonnet", price(3), "subscription"),
      model("claude-cli", "haiku", price(1), "subscription"),
    ];
    const text = modelsGuidance(cli, ref("claude-cli", "sonnet"));
    expect(text).toContain("provider claude-cli, a subscription");
    expect(text).toContain("- claude-cli/haiku: mid, $1/$5 per MTok");
  });

  it("lists unpriced faux models last", () => {
    const faux = [
      model("faux", "faux-text"),
      model("faux", "faux-1", price(1)),
      model("faux", "faux-2", price(3)),
    ];
    const lines = linesOf(modelsGuidance(faux, ref("faux", "faux-1")));
    expect(lines.at(-1)).toBe("- faux/faux-text: unpriced, 200k ctx, reasoning");
  });

  it("says fast is your own model when it sits on another provider", () => {
    const text = modelsGuidance(anthropic, ref("anthropic", "claude-sonnet-5"), ref("openai", "gpt-mini"));
    expect(text).toContain("`fast` = your own model");
    expect(text).toContain("claude-sonnet-5 (your model, fast)");
  });

  it("marks the parent as fast when fast equals it", () => {
    const parent = ref("anthropic", "claude-sonnet-5");
    expect(modelsGuidance(anthropic, parent, parent)).toContain("(your model, fast)");
  });

  it("states the policy for an unpriced or free parent", () => {
    const text = modelsGuidance([model("faux", "faux-text")], ref("faux", "faux-text"));
    expect(text).toContain(
      "If your own band is unpriced, you cannot compare: keep your own model unless the task clearly needs a smarter one. If it is free, nothing is lighter",
    );
    expect(text).toContain("Go heavier than your own model when the task needs a smarter one");
    expect(text).not.toContain("Never pick a band heavier");
  });
});
