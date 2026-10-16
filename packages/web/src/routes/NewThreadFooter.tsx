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

export function ProjectPicker(
  props: Pick<NewThreadFooterProps, "projects" | "projectId" | "onProject" | "disabled">,
) {
  return (
    <Combobox
      aria-label="Project"
      className="w-auto"
      disabled={props.disabled}
      options={projectsHomeFirst(props.projects).map(projectOption)}
      value={props.projectId}
      onChange={props.onProject}
    />
  );
}

export function NewThreadToolbar(props: Omit<NewThreadFooterProps, "projects" | "projectId" | "onProject">) {
  const showThinking = props.levels.some((level) => level !== "off");
  return (
    <>
      <ModelCombobox
        models={props.models}
        value={props.model}
        onChange={props.onModel}
        disabled={props.disabled}
        variant="ghost"
        size="sm"
        className="w-auto max-w-full"
        ariaLabel="Model"
      />
      {showThinking && (
        <Combobox
          aria-label="Thinking level"
          variant="ghost"
          size="sm"
          className="w-auto"
          disabled={props.disabled}
          options={props.levels.map((level) => ({ value: level, label: level }))}
          value={props.level}
          onChange={(value) => props.onLevel(value as ThinkingLevel)}
        />
      )}
    </>
  );
}
