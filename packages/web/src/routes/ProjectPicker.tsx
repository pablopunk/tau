import type { Project } from "@pi-everywhere/protocol";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { projectsHomeFirst } from "@/lib/new-thread-defaults";

const projectOption = (project: Project): ComboboxOption => ({
  value: project.id,
  label: project.name,
  disabled: project.status !== "ready",
  ...(project.status !== "ready" && { hint: project.status }),
});

interface ProjectPickerProps {
  projects: Project[];
  projectId: string;
  onProject(id: string): void;
  disabled: boolean;
}

export function ProjectPicker(props: ProjectPickerProps) {
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
