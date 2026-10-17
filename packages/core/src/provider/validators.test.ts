import { describe, expect, it } from "vitest";
import {
  type KeyValidator,
  validateAnthropicKey,
  validateGoogleKey,
  validateOpenAiKey,
  validateOpenCodeKey,
} from "./validators";

function fetchAnswering(status: number, body = "{}") {
  const requests: { url: string; headers: Headers }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(body, { status });
  }) as typeof fetch;
  return { fetchFn, requests };
}

const offline = (async () => {
  throw new TypeError("offline");
}) as typeof fetch;

const bearerValidators: [string, KeyValidator][] = [
  ["OpenAI", validateOpenAiKey],
  ["OpenCode", validateOpenCodeKey],
];

describe.each(bearerValidators)("%s validator", (_name, validate) => {
  it("sends the key as a bearer token and accepts a 200", async () => {
    const { fetchFn, requests } = fetchAnswering(200);
    expect(await validate("sk-1", fetchFn)).toBe("valid");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer sk-1");
  });

  it("rejects a 401, and cannot tell on 5xx or a network failure", async () => {
    expect(await validate("sk-1", fetchAnswering(401).fetchFn)).toBe("invalid");
    expect(await validate("sk-1", fetchAnswering(503).fetchFn)).toBe("unknown");
    expect(await validate("sk-1", offline)).toBe("unknown");
  });
});

describe("Anthropic validator", () => {
  it("sends x-api-key and the version header", async () => {
    const { fetchFn, requests } = fetchAnswering(200);
    expect(await validateAnthropicKey("sk-ant", fetchFn)).toBe("valid");
    expect(requests[0]?.headers.get("x-api-key")).toBe("sk-ant");
    expect(requests[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("rejects a 401", async () => {
    expect(await validateAnthropicKey("sk-ant", fetchAnswering(401).fetchFn)).toBe("invalid");
  });
});

describe("Google validator", () => {
  it("puts the encoded key in the query", async () => {
    const { fetchFn, requests } = fetchAnswering(200);
    expect(await validateGoogleKey("a b", fetchFn)).toBe("valid");
    expect(requests[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models?key=a%20b");
  });

  it("rejects a 400 INVALID_ARGUMENT, 401 and 403", async () => {
    const invalidArgument = JSON.stringify({ error: { status: "INVALID_ARGUMENT" } });
    expect(await validateGoogleKey("k", fetchAnswering(400, invalidArgument).fetchFn)).toBe("invalid");
    expect(await validateGoogleKey("k", fetchAnswering(401).fetchFn)).toBe("invalid");
    expect(await validateGoogleKey("k", fetchAnswering(403).fetchFn)).toBe("invalid");
  });

  it("cannot tell on any other 400", async () => {
    expect(await validateGoogleKey("k", fetchAnswering(400, "{}").fetchFn)).toBe("unknown");
  });
});
