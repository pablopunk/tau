import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { vi } from "vitest";

export function openRouterCatalogIds(): string[] {
  const models = createModels();
  models.setProvider(openrouterProvider());
  return models.getModels("openrouter").map((model) => model.id);
}

export interface OpenRouterStub {
  keyStatus: number;
  userModelsStatus: number;
  /** Ids returned by `GET /models/user`. */
  allowedModelIds: string[];
  readonly requests: { url: string; authorization: string | null }[];
}

/** Replaces `fetch` so no test reaches the network. Unknown URLs fail loudly. */
export function stubOpenRouter(initial: Partial<OpenRouterStub> = {}): OpenRouterStub {
  const stub: OpenRouterStub = {
    keyStatus: 200,
    userModelsStatus: 200,
    allowedModelIds: [],
    requests: [],
    ...initial,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      stub.requests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      if (url.endsWith("/api/v1/key")) return new Response("{}", { status: stub.keyStatus });
      if (url.endsWith("/api/v1/models/user")) {
        const data = stub.allowedModelIds.map((id) => ({ id }));
        return new Response(JSON.stringify({ data }), { status: stub.userModelsStatus });
      }
      throw new Error(`Unexpected request in a test: ${url}`);
    }),
  );
  return stub;
}
