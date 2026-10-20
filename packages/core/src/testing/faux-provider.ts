import type { Api, CredentialStore } from "@earendil-works/pi-ai";
import { createModels, type MutableModels, type Provider } from "@earendil-works/pi-ai/models";
import {
  type FauxModelDefinition,
  type FauxProviderHandle,
  type FauxResponseFactory,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { withFauxChatGptLogin } from "./faux-chatgpt-login";
import type { FauxReplies } from "./faux-replies";
import { createFauxScript } from "./faux-script";

export const FAUX_PROVIDER_ID = "faux";

const fixtureCost = (input: number, output: number) => ({ input, output, cacheRead: 0, cacheWrite: 0 });

export const FAUX_MODELS: FauxModelDefinition[] = [
  { id: "faux-1", name: "Faux One", reasoning: true, cost: fixtureCost(1, 5) },
  { id: "faux-2", name: "Faux Two", reasoning: false, cost: fixtureCost(3, 15) },
  { id: "faux-fast", name: "Faux Fast", reasoning: false, cost: fixtureCost(0.1, 0.5) },
  { id: "faux-text", name: "Faux Text", reasoning: false, input: ["text"] },
];

const QUEUED_STEPS = 8;

export interface FauxSetup {
  readonly models: MutableModels;
  readonly faux: FauxProviderHandle;
}

function keepScriptRunning(faux: FauxProviderHandle, script: FauxResponseFactory): FauxResponseFactory {
  const step: FauxResponseFactory = (...args) => {
    faux.appendResponses([step]);
    return script(...args);
  };
  return step;
}

export interface FauxSetupOptions {
  readonly tokensPerSecond?: number;
  readonly credentials?: CredentialStore;
  /** Prompt-keyed replies played before the generic script, for screenshots and demos. */
  readonly replies?: FauxReplies;
  /** The Claude CLI provider, backed by the fake Agent SDK, so a thread on one of its models runs in faux mode. */
  readonly claudeCli?: Provider<Api> | null;
}

export function createFauxSetup(options: FauxSetupOptions = {}): FauxSetup {
  const faux = fauxProvider({ models: FAUX_MODELS, tokensPerSecond: options.tokensPerSecond });
  const script = createFauxScript(options.replies);
  faux.setResponses(Array.from({ length: QUEUED_STEPS }, () => keepScriptRunning(faux, script)));
  const models = createModels({ credentials: options.credentials });
  models.setProvider(faux.provider);
  models.setProvider(withFauxChatGptLogin(faux.provider));
  if (options.claudeCli) models.setProvider(options.claudeCli);
  return { models, faux };
}
