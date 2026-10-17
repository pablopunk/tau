import type { ModelInfo, ModelRef, ThinkingLevel } from "@pi-everywhere/protocol";
import { type Ref, useImperativeHandle, useRef } from "react";
import { Combobox } from "@/components/ui/combobox";
import { ModelCombobox } from "@/setup/ModelCombobox";

export interface PickersHandle {
  openModel(): void;
  openThinking(): void;
}

export interface ModelThinkingPickersProps {
  ref?: Ref<PickersHandle>;
  models: ModelInfo[];
  model: ModelRef | null;
  onModel(ref: ModelRef): void;
  levels: ThinkingLevel[];
  level: ThinkingLevel;
  onLevel(level: ThinkingLevel): void;
  disabled?: boolean;
}

export function ModelThinkingPickers(props: ModelThinkingPickersProps) {
  const showThinking = props.levels.some((level) => level !== "off");
  const container = useRef<HTMLDivElement>(null);
  const clickTrigger = (label: string) =>
    container.current?.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click();
  useImperativeHandle(props.ref, () => ({
    openModel: () => clickTrigger("Model"),
    openThinking: () => clickTrigger("Thinking level"),
  }));
  return (
    <div ref={container} className="contents">
      <ModelCombobox
        models={props.models}
        value={props.model}
        onChange={props.onModel}
        disabled={props.disabled}
        variant="ghost"
        size="sm"
        className="w-auto min-w-0 max-w-full"
        ariaLabel="Model"
      />
      {showThinking && (
        <Combobox
          aria-label="Thinking level"
          variant="ghost"
          size="sm"
          className="w-auto"
          searchable={false}
          disabled={props.disabled}
          options={props.levels.map((level) => ({ value: level, label: level }))}
          value={props.level}
          onChange={(value) => props.onLevel(value as ThinkingLevel)}
        />
      )}
    </div>
  );
}
