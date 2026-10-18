import type { ModelRef } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { resolveModelAlias } from "./model-alias";

const ref = (provider: string, modelId: string): ModelRef => ({ provider, modelId });
const parent = ref("openrouter", "gpt-5");
const connected = [
  ref("anthropic", "claude-opus-4"),
  ref("anthropic", "claude-opus-4.1"),
  ref("anthropic", "claude-sonnet-4"),
  ref("openrouter", "anthropic/claude-opus-4"),
  ref("openrouter", "anthropic/claude-opus-4.5"),
  parent,
];
const context = { parent, fast: ref("openrouter", "anthropic/claude-haiku-4"), connected };
const anthropicParent = { ...context, parent: ref("anthropic", "x") };

describe("resolveModelAlias", () => {
  it("inherits by default and by name", () => {
    expect(resolveModelAlias(undefined, context)).toBe(parent);
    expect(resolveModelAlias("inherit", context)).toBe(parent);
  });

  it("uses the fast model on the parent's provider, else the parent", () => {
    expect(resolveModelAlias("fast", context)).toEqual(context.fast);
    expect(resolveModelAlias("fast", { ...context, fast: undefined })).toBe(parent);
    expect(resolveModelAlias("fast", { ...context, fast: ref("anthropic", "claude-haiku-4") })).toBe(parent);
  });

  it("accepts an exact provider/modelId of the parent's provider", () => {
    expect(resolveModelAlias("openrouter/gpt-5", context)).toEqual(parent);
  });

  it("refuses an exact model of another provider and lists the parent's models", () => {
    expect(() => resolveModelAlias("anthropic/claude-opus-4", context)).toThrow(
      /Subagents use the parent's provider \(openrouter\)\. Options: .*openrouter\/gpt-5/,
    );
    expect(() => resolveModelAlias("anthropic/claude-opus-4", context)).not.toThrow(
      /anthropic\/claude-opus-4\.1/,
    );
  });

  it("searches aliases only on the parent's provider, highest version first", () => {
    expect(resolveModelAlias("opus", context)).toEqual(ref("openrouter", "anthropic/claude-opus-4.5"));
    expect(resolveModelAlias("opus", anthropicParent)).toEqual(ref("anthropic", "claude-opus-4.1"));
  });

  it("does not leave the parent's provider when the alias only matches elsewhere", () => {
    expect(() => resolveModelAlias("sonnet", context)).toThrow(/Options: openrouter\//);
  });

  it("is deterministic whatever the input order", () => {
    const shuffled = { ...anthropicParent, connected: [...connected].reverse() };
    expect(resolveModelAlias("OPUS", shuffled)).toEqual(ref("anthropic", "claude-opus-4.1"));
  });

  it("lists at most 10 options when nothing matches", () => {
    const many = Array.from({ length: 12 }, (_, i) => ref("openrouter", `m${i}`));
    expect(() => resolveModelAlias("zzz", { ...context, connected: many })).toThrow(/m9/);
    expect(() => resolveModelAlias("zzz", { ...context, connected: many })).not.toThrow(/m10/);
  });
});
