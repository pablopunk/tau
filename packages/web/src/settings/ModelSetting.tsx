import type { ModelInfo, ModelRef, ThinkingLevel } from "@tau/protocol";
import { useId } from "react";
import { ThinkingCombobox } from "@/components/ThinkingCombobox";
import { findModel } from "@/lib/new-thread-defaults";
import { ModelCombobox } from "@/setup/ModelCombobox";

interface ModelSettingProps {
  label: string;
  models: ModelInfo[];
  model: ModelRef | null;
  level: ThinkingLevel | null;
  onModel: (ref: ModelRef) => void;
  onLevel: (level: ThinkingLevel | null) => void;
  clearLabel?: string;
  onClear?: () => void;
}

export function ModelSetting(props: ModelSettingProps) {
  const id = useId();
  const levels = findModel(props.models, props.model)?.thinkingLevels ?? ["off"];
  return (
    <>
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <ModelCombobox
          id={id}
          models={props.models}
          value={props.model}
          onChange={props.onModel}
          clearLabel={props.clearLabel}
          onClear={props.onClear}
          className="sm:flex-1"
        />
        <ThinkingCombobox levels={levels} value={props.level} onChange={props.onLevel} className="sm:w-40" />
      </div>
    </>
  );
}
