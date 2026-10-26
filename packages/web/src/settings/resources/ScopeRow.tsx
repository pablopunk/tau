import type { ResourcePriority, ResourceScope } from "@tau/protocol";
import { Field, FieldLabel } from "@/components/ui/field";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { SettingRow } from "@/components/ui/settings-layout";

const option = (value: ResourcePriority, label: string): SegmentedOption<ResourcePriority> => ({
  value,
  label,
  icon: <span className="px-1">{label}</span>,
});

const OPTIONS = [option("off", "Off"), option("balanced", "Balanced"), option("background", "Background")];

interface ScopeRowProps {
  id: string;
  label: string;
  scope: ResourceScope;
  value: ResourcePriority;
  disabled: boolean;
  onChange: (scope: ResourceScope, level: ResourcePriority) => void;
}

/** One power row: which CPU priority this kind of thread runs at. */
export function ScopeRow({ id, label, scope, value, disabled, onChange }: ScopeRowProps) {
  return (
    <SettingRow id={id}>
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>{label}</FieldLabel>
          <SegmentedControl
            aria-label={`${label} power`}
            value={value}
            options={OPTIONS}
            onChange={(level) => !disabled && onChange(scope, level)}
          />
        </div>
      </Field>
    </SettingRow>
  );
}
