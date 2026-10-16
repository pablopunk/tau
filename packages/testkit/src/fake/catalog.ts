import type { ModelInfo } from "@pi-everywhere/protocol";

export const FAKE_PROVIDER_ID = "openrouter";

export const FAKE_MODELS: readonly ModelInfo[] = [
  { provider: "faux", modelId: "faux-1", name: "Faux One", contextWindow: 128000, reasoning: true },
  { provider: "faux", modelId: "faux-2", name: "Faux Two", contextWindow: 128000, reasoning: false },
];
