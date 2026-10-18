import { Separator } from "@/components/ui/separator";
import { DevicesSection } from "./DevicesList";
import { LinkDeviceRow } from "./LinkDeviceRow";
import { RemoteAccessRow } from "./RemoteAccessRow";

export function RemoteSection() {
  return (
    <>
      <RemoteAccessRow />
      <Separator />
      <LinkDeviceRow />
      <Separator />
      <DevicesSection />
    </>
  );
}
