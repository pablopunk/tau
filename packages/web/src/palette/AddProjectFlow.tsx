import { useNavigate } from "react-router";
import { newThreadPath } from "@/lib/paths";
import { queryKeys } from "@/lib/queries";
import { NodeProvider, useHubQueryClient } from "@/nodes";
import { AddProjectDialog } from "@/sidebar/AddProjectDialog";

export interface AddProjectStep {
  nodeId: string | undefined;
}

/** Add a project on the chosen node, then open a new thread in it. */
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
  const { nodeId } = state;
  const dialog = (
    <AddProjectDialog
      onClose={() => onChange(null)}
      onAdded={(project) => {
        void hub.invalidateQueries({ queryKey: queryKeys.projects });
        void hub.invalidateQueries({ queryKey: ["node-data"] });
        navigate(newThreadPath(project.id, nodeId));
      }}
    />
  );
  if (nodeId === undefined) return dialog;
  return (
    <NodeProvider key={nodeId} nodeId={nodeId}>
      {dialog}
    </NodeProvider>
  );
}
