import type { FileRef, ImageInput } from "@tau/protocol";

export interface FirstMessage {
  readonly text: string;
  readonly images: readonly ImageInput[];
  readonly files?: readonly FileRef[];
}

export const FIRST_MESSAGE_STATE_KEY = "tauFirstMessage";

const idPrefix = Math.random().toString(36).slice(2);
let nextId = 0;
let staged: { id: string; message: FirstMessage } | undefined;

export function firstMessageState(message: FirstMessage): Record<string, unknown> {
  const id = `${idPrefix}-${++nextId}`;
  staged = { id, message };
  return { [FIRST_MESSAGE_STATE_KEY]: { id } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idOf(locationState: unknown): string | undefined {
  if (!isRecord(locationState)) return undefined;
  const value = locationState[FIRST_MESSAGE_STATE_KEY];
  return isRecord(value) && typeof value.id === "string" ? value.id : undefined;
}

export function firstMessageOf(locationState: unknown): FirstMessage | undefined {
  try {
    const id = idOf(locationState);
    if (id === undefined || staged?.id !== id) return undefined;
    return { ...staged.message, files: staged.message.files ?? [] };
  } catch {
    return undefined;
  }
}

export function forgetFirstMessage(locationState: unknown): void {
  try {
    if (idOf(locationState) === staged?.id) staged = undefined;
  } catch {
    // Browser history state can be unreadable in unusual environments.
  }
}
