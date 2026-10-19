import type { Core } from "@tau/protocol";

const MAX_LABEL = 120;

/** A label for the audit header `x-tau-via`: control characters become spaces, at most 120 characters. */
export const sanitiseVia = (label: string): string => label.replace(/\p{Cc}/gu, " ").slice(0, MAX_LABEL);

export interface DeviceLabels {
  label(deviceId: string): string;
  stop(): void;
}

/** Device names for the audit header `x-tau-via`; the device id until the list is read or for an unknown one. */
export function createDeviceLabels(core: Core): DeviceLabels {
  const names = new Map<string, string>();
  const refresh = () =>
    Promise.resolve()
      .then(() => core.access.listDevices())
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
    label: (deviceId) => sanitiseVia(names.get(deviceId) ?? deviceId),
    stop,
  };
}
