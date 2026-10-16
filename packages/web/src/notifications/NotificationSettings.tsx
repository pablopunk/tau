import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

/** Placeholder: owner E replaces it with the notifications switch that asks for permission. */
export function NotificationSettings() {
  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor="notifications-switch">Notifications</FieldLabel>
        <Switch id="notifications-switch" disabled />
      </div>
      <FieldDescription>Notify me when a run ends and this page is hidden.</FieldDescription>
    </Field>
  );
}
