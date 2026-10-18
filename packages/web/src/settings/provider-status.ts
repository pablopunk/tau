import type { ProviderInfo } from "@tau/protocol";

export function connectionLabel({ connection }: ProviderInfo): string {
  if (!connection) return "Not connected";
  if (connection.source === "env") return "From environment";
  if (connection.valid === false) return "Invalid key";
  if (connection.valid === null) return "Key not checked";
  return connection.method === "chatgpt" ? "Connected · ChatGPT" : "Connected · key";
}

export const isConnected = ({ connection }: ProviderInfo): boolean =>
  connection !== null &&
  connection.valid !== false &&
  (connection.valid !== null || connection.source === "env");

export const isFromEnvironment = ({ connection }: ProviderInfo): boolean => connection?.source === "env";
export const isStored = ({ connection }: ProviderInfo): boolean => connection?.source === "file";
export const canSignInWithChatGpt = ({ methods }: ProviderInfo): boolean => methods.includes("chatgpt");
const canUseKey = ({ methods }: ProviderInfo): boolean => methods.includes("api_key");
export const keyActionLabel = (provider: ProviderInfo): string =>
  provider.connection?.method === "api_key" && isStored(provider) ? "Replace key" : "Add key";

export const ENV_HELP = "A stored key overrides the environment key.";
export const CHATGPT_COPY = "Uses your ChatGPT plan. Personal use.";
const KEY_COPY = "Uses an API key.";

export function providerDescription(provider: ProviderInfo): string {
  if (isFromEnvironment(provider)) return ENV_HELP;
  return canSignInWithChatGpt(provider) ? CHATGPT_COPY : KEY_COPY;
}

export function connectedNote(provider: ProviderInfo): string {
  if (isFromEnvironment(provider)) return "From environment";
  return provider.connection?.method === "chatgpt" ? "ChatGPT plan" : KEY_COPY;
}

export const connectedTooltip = (provider: ProviderInfo): string =>
  isFromEnvironment(provider) ? `From environment. ${ENV_HELP}` : connectionLabel(provider);

export type ProviderAction = "sign-in" | "key" | "disconnect";

/** Ordered actions for a provider; the first is the primary button, the rest go in the overflow menu. */
export function providerActions(provider: ProviderInfo): ProviderAction[] {
  const signedInWithChatGpt = provider.connection?.method === "chatgpt";
  const actions: ProviderAction[] = [];
  if (canSignInWithChatGpt(provider) && !signedInWithChatGpt) actions.push("sign-in");
  if (canUseKey(provider)) actions.push("key");
  if (canSignInWithChatGpt(provider) && signedInWithChatGpt) actions.push("sign-in");
  if (isStored(provider)) actions.push("disconnect");
  return actions;
}

export function actionLabel(action: ProviderAction, provider: ProviderInfo): string {
  if (action === "sign-in") return "Sign in with ChatGPT";
  return action === "key" ? keyActionLabel(provider) : "Disconnect";
}
