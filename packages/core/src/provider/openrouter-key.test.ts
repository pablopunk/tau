import { afterEach, describe, expect, it, vi } from "vitest";
import { stubOpenRouter } from "../test-support/stub-openrouter";
import { assertOpenRouterKeyIsValid, checkOpenRouterKey, OPENROUTER_KEY_URL } from "./openrouter-key";

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter key validation", () => {
  it("asks GET /api/v1/key with the key as a bearer token", async () => {
    const stub = stubOpenRouter();
    expect(await checkOpenRouterKey("sk-good")).toBe("valid");
    expect(stub.requests).toEqual([{ url: OPENROUTER_KEY_URL, authorization: "Bearer sk-good" }]);
  });

  it.each([401, 403])("treats HTTP %i as an invalid key", async (keyStatus) => {
    stubOpenRouter({ keyStatus });
    expect(await checkOpenRouterKey("sk-bad")).toBe("invalid");
    await expect(assertOpenRouterKeyIsValid("sk-bad")).rejects.toMatchObject({ code: "invalid_key" });
  });

  it("does not call a server error an invalid key", async () => {
    stubOpenRouter({ keyStatus: 503 });
    await expect(assertOpenRouterKeyIsValid("sk-any")).rejects.toMatchObject({ code: "internal" });
  });

  it("reports an unreachable OpenRouter as internal", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(checkOpenRouterKey("sk-any")).rejects.toMatchObject({ code: "internal" });
  });
});
