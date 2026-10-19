import type { Core } from "@tau/protocol";

const MAX_LABEL = 120;

export interface DeviceLabels {
  label(deviceId: string): string;
  stop(): void;
}

/** Device names for the audit header `x-tau-hub-device`; the device id until the list is read or for an unknown one. */
export function createDeviceLabels(core: Core): DeviceLabels {
  const names = new Map<string, string>();
  const refresh = () =>
    core.access
      .listDevices()
      .then((devices) => {
        names.clear();
        for (const device of devices) names.set(device.id, device.name);
      })
      .catch(() => undefined);
  void refresh();
  const stop = core.onChange((change) => {
    if (change.resource === "devices") void refresh();
  });
  return {
    label: (deviceId) => (names.get(deviceId) ?? deviceId).replace(/\p{Cc}/gu, " ").slice(0, MAX_LABEL),
    stop,
  };
}
