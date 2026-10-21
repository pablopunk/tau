import { describe, expect, it, vi } from "vitest";
import { createAvailabilityCache, fingerprintKey, isDecisionsNotFound } from "./availability";
import { createFakeDecideClient } from "./fake";
import { createOpenaiClient } from "./openai";
import { pick } from "./selector";
import { createTypesafeClient } from "./typesafe";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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

describe("typesafe client", () => {
  it("is unavailable without a key and never rejects check", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}));
    const client = createTypesafeClient({ readCredential: async () => undefined, env: {}, fetchFn });
    expect(await client.check()).toBe("unavailable");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps probe statuses to ready/unavailable/unknown", async () => {
    const readCredential = async () => "sk-test";
    expect(
      await createTypesafeClient({ readCredential, env: {}, fetchFn: async () => jsonResponse({}) }).check(),
    ).toBe("ready");
    for (const status of [401, 403, 404]) {
      const client = createTypesafeClient({
        readCredential,
        env: {},
        fetchFn: async () => new Response("nope", { status }),
      });
      expect(await client.check()).toBe("unavailable");
    }
    expect(
      await createTypesafeClient({
        readCredential,
        env: {},
        fetchFn: async () => new Response("busy", { status: 500 }),
      }).check(),
    ).toBe("unknown");
    expect(
      await createTypesafeClient({
        readCredential,
        env: {},
        fetchFn: async () => {
          throw new Error("offline");
        },
      }).check(),
    ).toBe("unknown");
  });

  it("reads the key from env when no file credential exists", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse({ models: [] }));
    const client = createTypesafeClient({
      readCredential: async () => undefined,
      env: { TYPESAFE_API_KEY: "sk-env" },
      fetchFn,
    });
    expect(await client.check()).toBe("ready");
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: "Bearer sk-env" } });
  });

  it("posts a noul keep question and parses the probability", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse({ answers: { keep: { noul: 0.73 } } }));
    const client = createTypesafeClient({ readCredential: async () => "sk-test", env: {}, fetchFn });
    expect(await client.predicate("call", "keep?")).toBeCloseTo(0.73);
    const [[url, init]] = fetchFn.mock.calls as unknown as [[string, RequestInit]];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "jev-latest",
      state: "call",
      questions: { keep: { type: "noul", instructions: "keep?" } },
    });
  });

  it("rejects without a key and surfaces a live 404 for demotion", async () => {
    const missing = createTypesafeClient({ readCredential: async () => undefined, env: {} });
    await expect(missing.predicate("x", "y")).rejects.toMatchObject({ code: "no_provider" });
    const gone = createTypesafeClient({
      readCredential: async () => "sk-test",
      env: {},
      fetchFn: async () => new Response("gone", { status: 404 }),
    });
    const error = await gone.predicate("x", "y").catch((cause: unknown) => cause);
    expect(isDecisionsNotFound(error)).toBe(true);
  });
  it("prefers an explicit base-URL env override (localhost mock seam)", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse({ answers: { keep: { noul: 0.5 } } }));
    const client = createTypesafeClient({
      readCredential: async () => "sk-test",
      env: { TAU_TYPESAFE_BASE_URL: "http://127.0.0.1:9" },
      fetchFn,
    });
    await client.predicate("call", "keep?");
    const [[url]] = fetchFn.mock.calls as unknown as [[string]];
    expect(url).toBe("http://127.0.0.1:9/v1/systemone");
  });
});

describe("openai client", () => {
  it("prefers an explicit endpoint env override (localhost mock seam)", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse({ answers: [{ type: "predicate", name: "keep", probability: 0.5 }] }),
    );
    const client = createOpenaiClient({
      getAuth: async () => ({ auth: { apiKey: "sk-test" } }),
      env: { TAU_OPENAI_DECISIONS_URL: "http://127.0.0.1:9/v1/decisions" },
      fetchFn,
    });
    await client.predicate("call", "keep?");
    const [[url]] = fetchFn.mock.calls as unknown as [[string]];
    expect(url).toBe("http://127.0.0.1:9/v1/decisions");
  });
  it("is unavailable without a key and unknown on network failure", async () => {
    const client = createOpenaiClient({ getAuth: async () => undefined });
    expect(await client.check()).toBe("unavailable");
    const offline = createOpenaiClient({
      getAuth: async () => ({ auth: { apiKey: "sk-test" } }),
      fetchFn: async () => {
        throw new Error("offline");
      },
    });
    expect(await offline.check()).toBe("unknown");
  });

  it("maps probe denials to unavailable", async () => {
    const getAuth = async () => ({ auth: { apiKey: "sk-test" } });
    for (const status of [403, 404]) {
      const client = createOpenaiClient({ getAuth, fetchFn: async () => new Response("no", { status }) });
      expect(await client.check()).toBe("unavailable");
    }
    const missing = createOpenaiClient({
      getAuth,
      fetchFn: async () =>
        new Response(JSON.stringify({ error: { code: "model_not_found" } }), { status: 400 }),
    });
    expect(await missing.check()).toBe("unavailable");
    const ready = createOpenaiClient({ getAuth, fetchFn: async () => jsonResponse({ probability: 1 }) });
    expect(await ready.check()).toBe("ready");
  });

  it("posts a predicate and parses the probability", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse({ answers: [{ type: "predicate", name: "keep", probability: 0.2 }] }),
    );
    const client = createOpenaiClient({ getAuth: async () => ({ auth: { apiKey: "sk-test" } }), fetchFn });
    expect(await client.predicate("call", "keep?")).toBeCloseTo(0.2);
    const [[url, init]] = fetchFn.mock.calls as unknown as [[string, RequestInit]];
    expect(url).toBe("https://api.openai.com/v1/decisions");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "gpt-6-luna",
      input: "call",
      questions: [{ type: "predicate", name: "keep", instructions: "keep?" }],
    });
  });
});

describe("availability cache", () => {
  it("caches ready per key, re-probes on key change, and demotes on live 404", async () => {
    const check = vi.fn(async () => "ready" as const);
    const cache = createAvailabilityCache(60_000, () => 0);
    const client = createFakeDecideClient({ id: "typesafe" });
    const probing = { ...client, check };
    expect(await cache.check(probing, "key-a")).toBe("ready");
    expect(await cache.check(probing, "key-a")).toBe("ready");
    expect(check).toHaveBeenCalledTimes(1);
    expect(await cache.check(probing, "key-b")).toBe("ready");
    expect(check).toHaveBeenCalledTimes(2);
    cache.reportNotFound(probing, "key-b");
    expect(cache.peek(probing, "key-b")).toBe("unavailable");
    expect(cache.peek(probing, "key-a")).toBe("ready");
  });

  it("never caches unknown so callers try live", async () => {
    const check = vi.fn(async () => "unknown" as const);
    const cache = createAvailabilityCache(60_000, () => 0);
    const client = { ...createFakeDecideClient({ id: "openai" }), check };
    expect(await cache.check(client, "key-a")).toBe("unknown");
    expect(await cache.check(client, "key-a")).toBe("unknown");
    expect(check).toHaveBeenCalledTimes(2);
    expect(cache.peek(client, "key-a")).toBe("unknown");
  });

  it("fingerprints without exposing the key", () => {
    expect(fingerprintKey(undefined)).toBe("none");
    expect(fingerprintKey("sk-a")).not.toContain("sk-a");
    expect(fingerprintKey("sk-a")).toBe(fingerprintKey("sk-a"));
    expect(fingerprintKey("sk-a")).not.toBe(fingerprintKey("sk-b"));
  });
});
