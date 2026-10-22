import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { SettingRow } from "@/components/ui/settings-layout";
import type { SandboxScope } from "./sandbox-text";

type OnOff = "off" | "on";

const option = (value: OnOff, label: string): SegmentedOption<OnOff> => ({
  value,
  label,
  icon: <span className="px-1">{label}</span>,
});

const OPTIONS = [option("off", "Off"), option("on", "On")];

interface SandboxScopeRowProps {
  id: string;
  label: string;
  scope: SandboxScope;
  value: boolean;
  status: string;
  disabled: boolean;
  onChange: (scope: SandboxScope, next: boolean) => void;
}

/** One sandbox row: whether this kind of thread is confined to its own worktree. */
export function SandboxScopeRow({
  id,
  label,
  scope,
  value,
  status,
  disabled,
  onChange,
}: SandboxScopeRowProps) {
  return (
    <SettingRow id={id}>
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>{label}</FieldLabel>
          <SegmentedControl
            aria-label={`${label} sandbox`}
            value={value ? "on" : "off"}
            options={OPTIONS}
            onChange={(next) => !disabled && onChange(scope, next === "on")}
          />
        </div>
        <FieldDescription>{status}</FieldDescription>
      </Field>
    </SettingRow>
  );
}
