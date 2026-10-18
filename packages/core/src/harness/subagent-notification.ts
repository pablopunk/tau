import { SUBAGENT_NOTIFICATION_KIND, type SubagentNotificationData } from "@tau/protocol";

export const notificationText = ({ childId, status, report }: SubagentNotificationData) =>
  `<subagent-notification id="${childId}" status="${status}">${report}</subagent-notification>`;

export const notificationRequestId = (childId: string, childRequestId: string) =>
  `subagent-report:${childId}:${childRequestId}`;

export const notificationInput = (data: SubagentNotificationData) =>
  ({
    type: "input",
    content: notificationText(data),
    whenBusy: "followUp",
    entry: { kind: SUBAGENT_NOTIFICATION_KIND, data },
  }) as const;
