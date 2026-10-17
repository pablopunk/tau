import { NotificationSettings } from "@/notifications";
import { AppearanceSettings } from "./AppearanceSettings";

export function GeneralSection() {
  return (
    <>
      <AppearanceSettings />
      <NotificationSettings />
    </>
  );
}
