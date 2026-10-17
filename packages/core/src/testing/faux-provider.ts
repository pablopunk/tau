import type { CredentialStore } from "@earendil-works/pi-ai";
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import {
  type FauxModelDefinition,
  type FauxProviderHandle,
  type FauxResponseFactory,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { withFauxChatGptLogin } from "./faux-chatgpt-login";
import { createFauxScript } from "./faux-script";

export const FAUX_PROVIDER_ID = "faux";

export const FAUX_MODELS: FauxModelDefinition[] = [
  { id: "faux-1", name: "Faux One", reasoning: true },
  { id: "faux-2", name: "Faux Two", reasoning: false },
  { id: "faux-fast", name: "Faux Fast", reasoning: false },
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
}

export function createFauxSetup(options: FauxSetupOptions = {}): FauxSetup {
  const faux = fauxProvider({ models: FAUX_MODELS, tokensPerSecond: options.tokensPerSecond });
  const script = createFauxScript();
  faux.setResponses(Array.from({ length: QUEUED_STEPS }, () => keepScriptRunning(faux, script)));
  const models = createModels({ credentials: options.credentials });
  models.setProvider(faux.provider);
  models.setProvider(withFauxChatGptLogin(faux.provider));
  return { models, faux };
}
