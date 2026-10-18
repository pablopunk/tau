import type { Api } from "@earendil-works/pi-ai";
import type { Provider } from "@earendil-works/pi-ai/models";
import type { ClaudeCliModels } from "./models/claude-cli-models";
import type { ClaudeCliStreamer } from "./stream/claude-cli-stream";

export const CLAUDE_CLI_PROVIDER_ID = "claude-cli";
export const CLAUDE_CLI_PROVIDER_NAME = "Claude CLI";
const AUTH_SOURCE = "claude CLI";

/** Owner B. The pi-ai provider: configured only while the detector is `ready`, no process started to ask. */
export interface ClaudeCliProviderDeps {
  readonly models: ClaudeCliModels;
  readonly streamer: ClaudeCliStreamer;
  readonly isReady: () => boolean;
}

export function createClaudeCliProvider(deps: ClaudeCliProviderDeps): Provider<Api> {
  return {
    id: CLAUDE_CLI_PROVIDER_ID,
    name: CLAUDE_CLI_PROVIDER_NAME,
    auth: {
      apiKey: {
        name: "Claude CLI login",
        check: async () => (deps.isReady() ? { type: "api_key", source: AUTH_SOURCE } : undefined),
        resolve: async () => (deps.isReady() ? { auth: {}, source: AUTH_SOURCE } : undefined),
      },
    },
    getModels: () => deps.models.getModels(),
    refreshModels: () => deps.models.refresh(),
    stream: (model, context) => deps.streamer.streamSimple(model, context),
    streamSimple: (model, context, options) => deps.streamer.streamSimple(model, context, options),
  };
}
