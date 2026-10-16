import type { Core, CreateCore } from "@pi-everywhere/protocol";

export interface CreateCoreOptions {
  /** Data home directory (`~/.pi-everywhere` by default in the CLI). */
  readonly home: string;
  /** Use pi-ai's faux provider with the faux script instead of OpenRouter. */
  readonly faux?: boolean;
}

/** Stub: workstream A (core) replaces the body, never the signature. */
export const createCore: CreateCore = async (_options: CreateCoreOptions): Promise<Core> => {
  throw new Error("createCore is not implemented yet");
};
