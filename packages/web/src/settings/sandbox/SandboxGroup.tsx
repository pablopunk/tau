import type { SandboxSettings } from "@tau/protocol";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { SettingRow } from "@/components/ui/settings-layout";
import { useResourceSupport, useSetSandbox, useSettings } from "@/lib/queries";
import { NEEDS_UPDATE, NEW_COMMANDS_ONLY } from "../resources/resources-text";
import {
  PRESET_SETTINGS,
  presetOf,
  SANDBOX_BLURB,
  SANDBOX_UNENFORCED_BLURB,
  type SandboxPreset,
  scopeStatus,
} from "./sandbox-text";

const option = (value: SandboxPreset, label: string): SegmentedOption<SandboxPreset> => ({
  value,
  label,
  icon: <span className="px-1">{label}</span>,
});

const OPTIONS = [option("no", "No"), option("worktrees", "Worktrees"), option("all", "All")];

/** One preset row: No confines nothing, Worktrees confines worktree threads and their subagents, All confines everything. */
export function SandboxGroup() {
  const settings = useSettings();
  const save = useSetSandbox();
  const support = useResourceSupport();
  const value: SandboxSettings | undefined = settings.data?.sandbox;
  if (!settings.data) return null;
  const supported = value !== undefined;
  const capability = support.data?.sandbox;
  // `none` (or an unknown capability) enforces nothing: an editable row would be a lie.
  const enforceable = capability !== undefined && capability.mechanism !== "none";
  const disabled = !supported || !enforceable || save.isPending;
  const preset = value ? presetOf(value) : "no";
  const update = (next: SandboxPreset) => value && save.mutate({ ...value, ...PRESET_SETTINGS[next] });
  const unenforcedNote = capability?.note ? ` ${capability.note}` : "";

  return (
    <div className="flex flex-col gap-4" data-testid="sandbox-group">
      {!supported && (
        <p role="status" className="text-sm text-muted-foreground">
          {NEEDS_UPDATE}
        </p>
      )}
      <SettingRow id="sandbox">
        <Field>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Sandbox</FieldLabel>
            <SegmentedControl
              aria-label="Sandbox"
              value={preset}
              options={OPTIONS}
              onChange={(next) => !disabled && update(next)}
            />
          </div>
          <FieldDescription>
            {supported && !enforceable ? `${SANDBOX_UNENFORCED_BLURB}${unenforcedNote}` : SANDBOX_BLURB}
          </FieldDescription>
          <FieldDescription>{scopeStatus(preset !== "no", capability)}</FieldDescription>
        </Field>
      </SettingRow>
      {supported && enforceable && <p className="text-xs text-muted-foreground">{NEW_COMMANDS_ONLY}</p>}
    </div>
  );
}
