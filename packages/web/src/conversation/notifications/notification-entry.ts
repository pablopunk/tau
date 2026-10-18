import {
  SUBAGENT_NOTIFICATION_KIND,
  type SubagentNotificationData,
  SubagentNotificationDataSchema,
} from "@tau/protocol";
import { Value } from "typebox/value";

export const isSubagentNotificationKind = (kind: string): boolean => kind === SUBAGENT_NOTIFICATION_KIND;

export function parseSubagentNotification(data: unknown): SubagentNotificationData | undefined {
  return Value.Check(SubagentNotificationDataSchema, data) ? data : undefined;
}

export const isNotificationMarkerText = (text: string): boolean =>
  text.trimStart().startsWith("<subagent-notification");

export const notificationVerb = (status: SubagentNotificationData["status"]): string =>
  status === "done" ? "finished" : status;
