import type { ModelInfo, ModelRef, Project, ThinkingLevel } from "@pi-everywhere/protocol";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { projectsHomeFirst } from "@/lib/new-thread-defaults";
import { ModelCombobox } from "@/setup/ModelCombobox";

const projectOption = (project: Project): ComboboxOption => ({
  value: project.id,
  label: project.name,
  disabled: project.status !== "ready",
  ...(project.status !== "ready" && { hint: project.status }),
});

interface NewThreadFooterProps {
  projects: Project[];
  projectId: string;
  onProject(id: string): void;
  models: ModelInfo[];
  model: ModelRef | null;
  onModel(ref: ModelRef): void;
  levels: ThinkingLevel[];
  level: ThinkingLevel;
  onLevel(level: ThinkingLevel): void;
  disabled: boolean;
}

export function NewThreadFooter(props: NewThreadFooterProps) {
  const showThinking = props.levels.some((level) => level !== "off");
  return (
    <div className="flex flex-wrap gap-2">
      <Combobox
        aria-label="Project"
        className="w-auto"
        disabled={props.disabled}
        options={projectsHomeFirst(props.projects).map(projectOption)}
        value={props.projectId}
        onChange={props.onProject}
      />
      <ModelCombobox
        models={props.models}
        value={props.model}
        onChange={props.onModel}
        disabled={props.disabled}
        className="w-auto"
        ariaLabel="Model"
      />
      {showThinking && (
        <Combobox
          aria-label="Thinking level"
          className="w-auto"
          disabled={props.disabled}
          options={props.levels.map((level) => ({ value: level, label: level }))}
          value={props.level}
          onChange={(value) => props.onLevel(value as ThinkingLevel)}
        />
      )}
    </div>
  );
}
