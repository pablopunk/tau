import type { MessageMode, Settings, WorkspaceDefault } from "@tau/protocol";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { SettingRow } from "@/components/ui/settings-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettings, useSettingsSave } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { FastCompactionGroup } from "./FastCompactionGroup";

const textOption = <T extends string>(value: T, label: string): SegmentedOption<T> => ({
  value,
  label,
  icon: <span className="px-1">{label}</span>,
});

const MESSAGE_MODES = [textOption<MessageMode>("steer", "Steer"), textOption<MessageMode>("queue", "Queue")];

const WORKSPACE_MODES = [
  textOption<WorkspaceDefault>("per-project", "Remember per project"),
  textOption<WorkspaceDefault>("worktree", "Worktree"),
  textOption<WorkspaceDefault>("checkout", "Main checkout"),
];

const MESSAGE_MODE_LABEL = "While the agent works, new messages";
const WORKSPACE_LABEL = "New threads use";

export function AgentSection() {
  const api = useApi();
  const saveSettings = useSettingsSave();
  const settings = useSettings();
  const { run, error } = useSubmit();
  if (!settings.data) return <Skeleton className="h-9 w-full" />;

  const save = (patch: Partial<Settings>, action: () => Promise<unknown>) =>
    void run(() => saveSettings(patch, action));

  return (
    <div className="flex flex-col gap-4">
      <SettingRow id="message-mode">
        <Field>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>{MESSAGE_MODE_LABEL}</FieldLabel>
            <SegmentedControl
              aria-label={MESSAGE_MODE_LABEL}
              value={settings.data.messageMode}
              options={MESSAGE_MODES}
              onChange={(mode) => save({ messageMode: mode }, () => api.settings.setMessageMode(mode))}
            />
          </div>
          <FieldDescription>
            Steer lands at the next tool step. Queue waits for the final answer.
          </FieldDescription>
        </Field>
      </SettingRow>
      <SettingRow id="workspace-default">
        <Field>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>{WORKSPACE_LABEL}</FieldLabel>
            <SegmentedControl
              aria-label={WORKSPACE_LABEL}
              value={settings.data.workspaceDefault}
              options={WORKSPACE_MODES}
              onChange={(mode) =>
                save({ workspaceDefault: mode }, () => api.settings.setWorkspaceDefault(mode))
              }
            />
          </div>
        </Field>
      </SettingRow>
      <FastCompactionGroup />
      <FormError message={error} />
    </div>
  );
}
