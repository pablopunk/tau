export const notificationsSupported = (): boolean => typeof Notification !== "undefined";

export const notificationsGranted = (): boolean =>
  notificationsSupported() && Notification.permission === "granted";
