import type { Harness } from "@earendil-works/pi-durable";
import type { Project } from "@pi-everywhere/protocol";
import type { ChangeEmitter } from "../change-emitter";
import type { ProjectStore } from "../harness/project-store";
import type { SettingsStore } from "../home/settings-store";
import { notImplemented } from "../not-implemented";

export interface CloneServiceDeps {
  readonly harness: Harness;
  readonly projects: ProjectStore;
  readonly settings: SettingsStore;
  readonly changes: ChangeEmitter;
  readonly now: () => number;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly allowFileClones: boolean;
}

export interface CloneService {
  clone(input: { url: string; name?: string }): Promise<Project>;
  retryClone(id: string): Promise<void>;
  /** Marks interrupted clones as failed and deletes their claimed folders. */
  recoverAtStartup(): Promise<void>;
}

export function createCloneService(_deps: CloneServiceDeps): CloneService {
  return {
    async clone() {
      throw notImplemented("projects.clone");
    },
    async retryClone() {
      throw notImplemented("projects.retryClone");
    },
    async recoverAtStartup() {},
  };
}
