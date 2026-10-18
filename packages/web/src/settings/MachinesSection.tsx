import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { SettingRow } from "@/components/ui/settings-layout";

/**
 * PLACEHOLDER for owner H: the three `data-setting-id` rows exist so search and its index test stay in step.
 * Build "This machine" first, then the machine rows (`components/ui/machine-row.tsx`: name, OS, tau version, online
 * dot, last seen, thread count; rename, disconnect, "Open settings"), "Connect a machine" (the link dialog with the
 * `npx tau connect <link>` command) and "Linked to <hub>" with Disconnect.
 */
export function MachinesSection() {
  return (
    <>
      <SettingRow id="machines">
        <Field className="gap-2">
          <FieldLabel>Machines</FieldLabel>
          <FieldDescription>Linked machines appear here.</FieldDescription>
        </Field>
      </SettingRow>
      <Separator />
      <SettingRow id="connect-machine">
        <Field className="gap-2">
          <FieldLabel>Connect a machine</FieldLabel>
          <FieldDescription>Link another tau with one command.</FieldDescription>
        </Field>
      </SettingRow>
      <Separator />
      <SettingRow id="hub-link">
        <Field className="gap-2">
          <FieldLabel>Linked to a hub</FieldLabel>
          <FieldDescription>This machine is not linked to a hub.</FieldDescription>
        </Field>
      </SettingRow>
    </>
  );
}
