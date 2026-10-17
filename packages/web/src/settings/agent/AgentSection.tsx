import type { MessageMode, WorkspaceMode } from "@pi-everywhere/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { queryKeys, useSettings } from "@/lib/queries";

const textOption = <T extends string>(value: T, label: string): SegmentedOption<T> => ({
  value,
  label,
  icon: <span className="px-1">{label}</span>,
});

const MESSAGE_MODES = [textOption<MessageMode>("steer", "Steer"), textOption<MessageMode>("queue", "Queue")];

const WORKSPACE_MODES = [
  textOption<WorkspaceMode>("worktree", "Worktree"),
  textOption<WorkspaceMode>("checkout", "Main checkout"),
];

const MESSAGE_MODE_LABEL = "While the agent works, new messages";
const WORKSPACE_LABEL = "New threads use";

export function AgentSection() {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const { run, error } = useSubmit();
  if (!settings.data) return <Skeleton className="h-9 w-full" />;

  const save = (action: () => Promise<void>) =>
    void run(async () => {
      await action();
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    });

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>{MESSAGE_MODE_LABEL}</FieldLabel>
          <SegmentedControl
            aria-label={MESSAGE_MODE_LABEL}
            value={settings.data.messageMode}
            options={MESSAGE_MODES}
            onChange={(mode) => save(() => api.settings.setMessageMode(mode))}
          />
        </div>
        <FieldDescription>
          Steer lands at the next tool step. Queue waits for the final answer.
        </FieldDescription>
      </Field>
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>{WORKSPACE_LABEL}</FieldLabel>
          <SegmentedControl
            aria-label={WORKSPACE_LABEL}
            value={settings.data.workspaceDefault}
            options={WORKSPACE_MODES}
            onChange={(mode) => save(() => api.settings.setWorkspaceDefault(mode))}
          />
        </div>
      </Field>
      <FormError message={error} />
    </div>
  );
}
