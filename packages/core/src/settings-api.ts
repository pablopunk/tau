import { AppError, type Core } from "@pi-everywhere/protocol";
import type { SettingsStore } from "./home/settings-store";
import { notImplemented } from "./not-implemented";
import type { ProviderService } from "./provider/provider-service";

export function createSettingsApi(deps: {
  settings: SettingsStore;
  provider: ProviderService;
}): Core["settings"] {
  const { settings, provider } = deps;
  return {
    get: () => settings.get(),
    async setDefaultModel(ref) {
      if (!(await provider.isConfigured())) throw new AppError("no_provider", "Connect a provider first.");
      if (!(await provider.lists(ref))) {
        throw new AppError("invalid_request", "This model is not available for your API key.");
      }
      await settings.setDefaultModel(ref);
    },
    async setFastModel() {
      throw notImplemented("settings.setFastModel");
    },
    async setProjectsFolder() {
      throw notImplemented("settings.setProjectsFolder");
    },
  };
}
