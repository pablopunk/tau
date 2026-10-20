import type { ResourceAppliesTo, ResourceSettings } from "@tau/protocol";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { SettingRow } from "@/components/ui/settings-layout";
import { isAnyBoxTicked, isControlOn } from "./resources-text";

const BOXES: { key: keyof ResourceAppliesTo; label: string }[] = [
  { key: "main", label: "Main checkout threads" },
  { key: "worktrees", label: "Worktree threads" },
  { key: "subagents", label: "Subagents" },
];

interface AppliesToRowProps {
  value: ResourceSettings;
  disabled: boolean;
  onChange: (appliesTo: ResourceAppliesTo) => void;
}

export function AppliesToRow({ value, disabled, onChange }: AppliesToRowProps) {
  const controlOn = isControlOn(value);
  const idle = disabled || !controlOn;
  return (
    <SettingRow id="resources-applies-to">
      <Field>
        <FieldLabel>Apply resource control to</FieldLabel>
        <div className="flex flex-col gap-2">
          {BOXES.map(({ key, label }) => (
            <Label key={key} className="flex items-center gap-2 font-normal">
              <Checkbox
                disabled={idle}
                checked={value.appliesTo[key]}
                onCheckedChange={(checked) => onChange({ ...value.appliesTo, [key]: checked === true })}
              />
              {label}
            </Label>
          ))}
        </div>
        <FieldDescription>
          Subagents only is the default. A main thread in its own worktree stays at full speed unless Worktree
          threads is ticked.
        </FieldDescription>
        {controlOn && !isAnyBoxTicked(value.appliesTo) && (
          <FieldDescription role="status">Nothing is governed</FieldDescription>
        )}
      </Field>
    </SettingRow>
  );
}
