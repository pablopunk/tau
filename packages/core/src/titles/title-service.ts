import type { Models } from "@earendil-works/pi-ai/models";
import type { Harness } from "@earendil-works/pi-durable";
import type { ChangeEmitter } from "../change-emitter";
import type { SettingsStore } from "../home/settings-store";
import { notImplemented } from "../not-implemented";

export interface TitleServiceDeps {
  readonly harness: Harness;
  readonly models: Models;
  readonly settings: SettingsStore;
  readonly changes: ChangeEmitter;
}

export interface TitleService {
  /** Best-effort: names a conversation from its first message; failures are logged and ignored. */
  generateFor(conversationId: string, firstText: string): Promise<void>;
}

export function createTitleService(_deps: TitleServiceDeps): TitleService {
  return {
    async generateFor() {
      throw notImplemented("titles.generateFor");
    },
  };
}
