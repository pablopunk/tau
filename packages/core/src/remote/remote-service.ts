import { AppError, type Core } from "@tau/protocol";
import type { AccessService } from "../access/create-access";
import type { ChangeEmitter } from "../change-emitter";
import type { SettingsStore } from "../home/settings-store";
import type { RemoteAdapter } from "./ports";

export interface RemoteServiceDeps {
  readonly adapter: RemoteAdapter;
  readonly settings: Pick<SettingsStore, "setRemoteEnabled">;
  readonly access: Pick<AccessService, "clearAll">;
  readonly changes: ChangeEmitter;
}

/** `Core.remote` over the adapter. Owner B adds start-up (enabled → connect), the crash-loop rule and retries. */
export function createRemoteService({ adapter, settings, access, changes }: RemoteServiceDeps) {
  adapter.onStatus(() => changes.emit({ resource: "remote" }));
  const api: Core["remote"] = {
    status: async () => adapter.status(),
    async enable() {
      const status = await adapter.enable();
      await settings.setRemoteEnabled(true);
      changes.emit({ resource: "remote" });
      return status;
    },
    async disable() {
      const status = await adapter.disable();
      await settings.setRemoteEnabled(false);
      await access.clearAll();
      changes.emit({ resource: "remote" });
      return status;
    },
    async recreate() {
      if (!adapter.status().canRecreate) {
        throw new AppError("invalid_request", "The URL can only be replaced after 10 minutes offline.");
      }
      const status = await adapter.recreate();
      await access.clearAll();
      changes.emit({ resource: "remote" });
      return status;
    },
  };
  return { api, close: () => adapter.close() };
}
