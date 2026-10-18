import { SUBAGENT_NOTIFICATION_KIND, type SubagentNotificationData } from "@tau/protocol";
import type { Notification } from "./notification-submitter";

export const notificationText = ({ childId, status, report }: SubagentNotificationData) =>
  `<subagent-notification id="${childId}" status="${status}">${report}</subagent-notification>`;

export const notificationRequestId = (childId: string, childRequestId: string) =>
  `subagent-report:${childId}:${childRequestId}`;

export const subagentNotification = (
  data: SubagentNotificationData,
  childRequestId: string,
): Notification => ({
  kind: SUBAGENT_NOTIFICATION_KIND,
  data,
  text: notificationText(data),
  requestId: notificationRequestId(data.childId, childRequestId),
});
