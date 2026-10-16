const OPEN_SETTINGS_EVENT = "pi-everywhere:open-settings";

export const requestOpenSettings = () => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));

export const onOpenSettingsRequested = (listener: () => void): (() => void) => {
  window.addEventListener(OPEN_SETTINGS_EVENT, listener);
  return () => window.removeEventListener(OPEN_SETTINGS_EVENT, listener);
};
