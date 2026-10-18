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
  parent,
];
const context = { parent, fast: ref("anthropic", "claude-haiku-4"), connected };

describe("resolveModelAlias", () => {
  it("inherits by default and by name", () => {
    expect(resolveModelAlias(undefined, context)).toBe(parent);
    expect(resolveModelAlias("inherit", context)).toBe(parent);
  });

  it("uses the fast model, else the parent", () => {
    expect(resolveModelAlias("fast", context)).toEqual(context.fast);
    expect(resolveModelAlias("fast", { ...context, fast: undefined })).toBe(parent);
  });

  it("accepts an exact provider/modelId", () => {
    expect(resolveModelAlias("anthropic/claude-opus-4", context)).toEqual(ref("anthropic", "claude-opus-4"));
  });

  it("prefers the parent's provider, then the highest version", () => {
    expect(resolveModelAlias("opus", context)).toEqual(ref("openrouter", "anthropic/claude-opus-4"));
    expect(resolveModelAlias("opus", { ...context, parent: ref("anthropic", "x") })).toEqual(
      ref("anthropic", "claude-opus-4.1"),
    );
  });

  it("is deterministic whatever the input order", () => {
    const shuffled = { ...context, parent: ref("anthropic", "x"), connected: [...connected].reverse() };
    expect(resolveModelAlias("OPUS", shuffled)).toEqual(ref("anthropic", "claude-opus-4.1"));
  });

  it("lists at most 10 options when nothing matches", () => {
    const many = Array.from({ length: 12 }, (_, i) => ref("p", `m${i}`));
    expect(() => resolveModelAlias("zzz", { ...context, connected: many })).toThrow(/m9/);
    expect(() => resolveModelAlias("zzz", { ...context, connected: many })).not.toThrow(/m10/);
  });
});
