import type { MessageMode } from "@tau/protocol";
import type { QueuedMessage } from "../model/live";

export type WhenBusy = QueuedMessage["mode"];

export const queuedModeLabel = (mode: WhenBusy) => (mode === "steer" ? "Steering" : "Queued");

export const whenBusyOf = (mode: MessageMode): WhenBusy => (mode === "queue" ? "followUp" : "steer");

export const busyHintOf = (mode: WhenBusy) =>
  mode === "followUp" ? "Enter: queue · Alt+Enter: steer" : "Enter: steer · Alt+Enter: queue";
