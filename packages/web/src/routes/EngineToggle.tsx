import type { ExecutorKind } from "@tau/protocol";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NATIVE_LABEL } from "@/conversation/model/executor";

export function EngineToggle({
  value,
  onChange,
  disabled,
}: {
  value: ExecutorKind;
  onChange: (engine: ExecutorKind) => void;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={value}
      onValueChange={(next) => next && onChange(next as ExecutorKind)}
      aria-label="Engine"
      disabled={disabled}
    >
      <ToggleGroupItem value="pi">Pi</ToggleGroupItem>
      <ToggleGroupItem value="claude-code">{NATIVE_LABEL}</ToggleGroupItem>
    </ToggleGroup>
  );
}
