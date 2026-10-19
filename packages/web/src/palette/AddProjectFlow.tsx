import { useNavigate } from "react-router";
import { newThreadPath } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { MachineProvider, useHubQueryClient } from "@/machines";
import { AddProjectDialog } from "@/sidebar/AddProjectDialog";

export interface AddProjectStep {
  machineId: string | undefined;
}

/** Add a project on the chosen machine, then open a new thread in it. */
export function AddProjectFlow({
  state,
  onChange,
}: {
  state: AddProjectStep | null;
  onChange: (next: AddProjectStep | null) => void;
}) {
  const navigate = useNavigate();
  const hub = useHubQueryClient();
  if (state === null) return null;
  const { machineId } = state;
  const dialog = (
    <AddProjectDialog
      onClose={() => onChange(null)}
      onAdded={(project) => {
        void hub.invalidateQueries({ queryKey: queryKeys.projects });
        void hub.invalidateQueries({ queryKey: ["machine-data"] });
        navigate(newThreadPath(project.id, machineId));
      }}
    />
  );
  if (machineId === undefined) return dialog;
  return (
    <MachineProvider key={machineId} machineId={machineId}>
      {dialog}
    </MachineProvider>
  );
}
