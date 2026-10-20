import { describe, expect, it } from "vitest";
import { createFakeDecideClient } from "./fake";
import { createOpenaiClient } from "./openai";
import { pick } from "./selector";
import { createTypesafeClient } from "./typesafe";

describe("selector", () => {
  it("pins an explicit backend and defaults auto to the first client", () => {
    const typesafe = createFakeDecideClient({ id: "typesafe" });
    const openai = createFakeDecideClient({ id: "openai" });
    expect(pick("typesafe", [openai, typesafe])).toBe(typesafe);
    expect(pick("auto", [openai, typesafe])).toBe(openai);
    expect(pick("openai", [typesafe])).toBeUndefined();
  });
});

describe("fake client", () => {
  it("replays scripted probabilities and records calls", async () => {
    const fake = createFakeDecideClient({ id: "typesafe", probabilities: [0.9, 0.1] });
    expect(await fake.check()).toBe("ready");
    expect(await fake.predicate("a", "keep?")).toBe(0.9);
    expect(await fake.predicate("b", "keep?")).toBe(0.1);
    expect(fake.calls).toHaveLength(2);
  });
});

describe("live stubs", () => {
  it("throw until the live phase lands", async () => {
    const typesafe = createTypesafeClient({ readCredential: async () => undefined, env: {} });
    const openai = createOpenaiClient({ getAuth: async () => undefined });
    await expect(typesafe.check()).rejects.toMatchObject({ code: "internal" });
    await expect(openai.predicate("x", "y")).rejects.toMatchObject({ code: "internal" });
  });
});
