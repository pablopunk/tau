import { isNotificationText, type SubagentNotificationData } from "@tau/protocol";

export {
  isSubagentNotificationKind,
  type MvpNotificationItem,
  parseMvpNotification,
  parseSubagentNotification,
} from "@tau/protocol";

export const isNotificationMarkerText = isNotificationText;

export const notificationVerb = (status: SubagentNotificationData["status"]): string =>
  status === "done" ? "finished" : status;
