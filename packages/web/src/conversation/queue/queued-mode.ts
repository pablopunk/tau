import type { MessageMode, QueuedMessage } from "@tau/protocol";

export type WhenBusy = QueuedMessage["mode"];

/** Normalized queue-item kind: pre-contract payloads have no kind and read as user input. */
export function entryKindOf(item: { readonly entryKind?: string }): string {
  return item.entryKind ?? "pi.user";
}

const USER_ENTRY_KINDS: readonly string[] = ["pi.user", "native.user"];

/** Only user items (`pi.user`, `native.user`) render as messages. Goal directives ride the same policy. */
export function isUserItem(item: { readonly entryKind?: string }): boolean {
  return USER_ENTRY_KINDS.includes(entryKindOf(item));
}

/** Steer copy: delivered at the next tool boundary. */
export const STEER_COPY = "Delivered at the next tool boundary";

export const queuedModeLabel = (mode: WhenBusy) => (mode === "steer" ? "Steering" : "Queued");

export const whenBusyOf = (mode: MessageMode): WhenBusy => (mode === "queue" ? "followUp" : "steer");

export const busyHintOf = (mode: WhenBusy) =>
  mode === "followUp" ? "⏎ queue · ⌘⏎ steer" : "⏎ steer · ⌘⏎ queue";
