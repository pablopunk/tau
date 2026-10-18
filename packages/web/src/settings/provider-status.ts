import type { ProviderInfo } from "@tau/protocol";

export function connectionLabel({ connection }: ProviderInfo): string {
  if (!connection) return "Not connected";
  if (connection.source === "env") return "From environment";
  if (connection.valid === false) return "Invalid key";
  if (connection.valid === null) return "Key not checked";
  return connection.method === "chatgpt" ? "Connected · ChatGPT" : "Connected · key";
}

export const isFromEnvironment = ({ connection }: ProviderInfo): boolean => connection?.source === "env";
export const isStored = ({ connection }: ProviderInfo): boolean => connection?.source === "file";
export const canSignInWithChatGpt = ({ methods }: ProviderInfo): boolean => methods.includes("chatgpt");
export const keyActionLabel = (provider: ProviderInfo): string =>
  provider.connection?.method === "api_key" && isStored(provider) ? "Replace key" : "Add key";

export const ENV_HELP =
  "A stored key overrides the environment key. Disconnecting a stored key returns to the environment key.";
export const CHATGPT_COPY = "Uses your ChatGPT plan. Personal use.";
