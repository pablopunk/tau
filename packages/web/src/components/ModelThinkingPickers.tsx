import type { ModelInfo, ModelRef, ThinkingLevel } from "@tau/protocol";
import { type Ref, useImperativeHandle, useState } from "react";
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
  const [modelOpen, setModelOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  useImperativeHandle(props.ref, () => ({
    openModel: () => setModelOpen(true),
    openThinking: () => setThinkingOpen(true),
  }));
  return (
    <>
      <ModelCombobox
        models={props.models}
        value={props.model}
        onChange={props.onModel}
        disabled={props.disabled}
        variant="ghost"
        size="sm"
        className="w-auto min-w-0 max-w-full"
        ariaLabel="Model"
        open={modelOpen}
        onOpenChange={setModelOpen}
      />
      {showThinking && (
        <Combobox
          aria-label="Thinking level"
          variant="ghost"
          size="sm"
          className="w-auto"
          searchable={false}
          open={thinkingOpen}
          onOpenChange={setThinkingOpen}
          disabled={props.disabled}
          options={props.levels.map((level) => ({ value: level, label: level }))}
          value={props.level}
          onChange={(value) => props.onLevel(value as ThinkingLevel)}
        />
      )}
    </>
  );
}
