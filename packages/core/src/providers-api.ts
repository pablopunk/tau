import { AppError, type Core } from "@tau/protocol";
import type { ProviderService } from "./provider/provider-service";

export function createProvidersApi(provider: ProviderService): Pick<Core, "providers" | "models"> {
  return {
    providers: {
      list: () => provider.list(),
      setApiKey: (id, key) => provider.setApiKey(id, key),
      disconnect: (id) => provider.disconnect(id),
      acknowledgeClaudeCli: () => provider.acknowledgeClaudeCli(),
      refreshClaudeCli: () => provider.refreshClaudeCli(),
      installClaudeCliSdk: () => provider.installClaudeCliSdk(),
      async startLogin(id) {
        if (id !== "openai") throw new AppError("invalid_request", "This provider has no sign-in.");
        return provider.logins.start();
      },
      login: (sessionId) => provider.logins.get(sessionId),
      submitLoginUrl: (sessionId, url) => provider.logins.submitUrl(sessionId, url),
      cancelLogin: (sessionId) => provider.logins.cancel(sessionId),
    },
    models: { list: () => provider.listModels() },
  };
}
