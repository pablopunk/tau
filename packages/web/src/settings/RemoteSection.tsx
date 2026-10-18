import { SettingRow } from "@/components/ui/settings-layout";

/** Phase 0 seam. Owner D builds the switch, the link dialog and the devices list; the three rows keep these ids. */
export function RemoteSection() {
  return (
    <>
      <SettingRow id="remote-access">Remote access</SettingRow>
      <SettingRow id="link-device">Link a device</SettingRow>
      <SettingRow id="devices">Devices</SettingRow>
    </>
  );
}
