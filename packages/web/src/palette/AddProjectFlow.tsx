import { useNavigate } from "react-router";
import { newThreadPath } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { type MachineData, MachineProvider, useHubQueryClient } from "@/machines";
import { AddProjectDialog } from "@/sidebar/AddProjectDialog";
import { ChooseMachineDialog } from "@/sidebar/ChooseMachineDialog";

export type AddProjectStep = { step: "choose" } | { step: "add"; machineId: string | undefined };

/** Add a project from anywhere: asks whose disk first when several machines are linked, then opens a thread in it. */
export function AddProjectFlow({
  state,
  machines,
  onChange,
}: {
  state: AddProjectStep | null;
  machines: readonly MachineData[];
  onChange: (next: AddProjectStep | null) => void;
}) {
  const navigate = useNavigate();
  const hub = useHubQueryClient();
  if (state === null) return null;
  if (state.step === "choose") {
    return (
      <ChooseMachineDialog
        machines={machines}
        onClose={() => onChange(null)}
        onChoose={(machineId) => onChange({ step: "add", machineId })}
      />
    );
  }
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
