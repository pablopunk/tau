import { useState } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SettingRow } from "@/components/ui/settings-layout";
import { Switch } from "@/components/ui/switch";

interface LimitRowProps {
  id: string;
  label: string;
  description: string;
  unit: string;
  value: number | null;
  min: number;
  max?: number;
  fallback: number;
  disabled: boolean;
  onChange: (value: number | null) => void;
}

const inRange = (n: number, min: number, max?: number) =>
  Number.isInteger(n) && n >= min && (max === undefined || n <= max);

/** A number field with a switch: off is `null`, on is the number. */
export function LimitRow({
  id,
  label,
  description,
  unit,
  value,
  min,
  max,
  fallback,
  disabled,
  onChange,
}: LimitRowProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (value === null ? "" : String(value));
  const commit = () => {
    const n = Number(draft);
    setDraft(null);
    if (draft !== null && inRange(n, min, max) && n !== value) onChange(n);
  };
  return (
    <SettingRow id={id}>
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>{label}</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              aria-label={`${label} (${unit})`}
              className="w-24"
              min={min}
              max={max}
              disabled={disabled || value === null}
              value={text}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => event.key === "Enter" && commit()}
            />
            <Switch
              aria-label={`Limit: ${label}`}
              disabled={disabled}
              checked={value !== null}
              onCheckedChange={(on) => onChange(on ? fallback : null)}
            />
          </div>
        </div>
        <FieldDescription>{description}</FieldDescription>
      </Field>
    </SettingRow>
  );
}
