import { useState } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { preferences } from "@/lib/preferences";
import { notificationsGranted, notificationsSupported } from "./notification-support";

const DENIED_HINT = "Notifications are blocked in your browser settings.";

export function NotificationSettings() {
  const [enabled, setEnabled] = useState(
    () => preferences.getNotificationsEnabled() && notificationsGranted(),
  );
  const [denied, setDenied] = useState(false);

  const change = async (wanted: boolean) => {
    const granted = wanted && (await Notification.requestPermission()) === "granted";
    preferences.setNotificationsEnabled(granted);
    setEnabled(granted);
    setDenied(wanted && !granted);
  };

  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor="notifications-switch">Notifications</FieldLabel>
        <Switch
          id="notifications-switch"
          checked={enabled}
          disabled={!notificationsSupported()}
          onCheckedChange={change}
        />
      </div>
      <FieldDescription>
        {denied ? DENIED_HINT : "Notify me when a run ends and this page is hidden."}
      </FieldDescription>
    </Field>
  );
}
