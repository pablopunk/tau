import { access } from "node:fs/promises";
import { homedir } from "node:os";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

export type Environment = Readonly<Record<string, string | undefined>>;

const fileExists = async (path: string) =>
  access(path.replace(/^~(?=$|\/)/, homedir())).then(
    () => true,
    () => false,
  );

export function createRealModels(credentials: CredentialStore, env: Environment): Models {
  const models = createModels({ credentials, authContext: { env: async (name) => env[name], fileExists } });
  for (const provider of [
    openrouterProvider(),
    openaiProvider(),
    anthropicProvider(),
    googleProvider(),
    opencodeProvider(),
    opencodeGoProvider(),
  ]) {
    models.setProvider(provider);
  }
  return models;
}
