import {
  HEAVY_SLOTS_MAX,
  HEAVY_SLOTS_MIN,
  MEMORY_LIMIT_MIN_MB,
  type ResourcePriority,
  type ResourceSettings,
} from "@tau/protocol";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { SettingRow } from "@/components/ui/settings-layout";
import { useResourceActivity, useResourceSupport, useSetResources, useSettings } from "@/lib/queries";
import { AppliesToRow } from "./AppliesToRow";
import { HoldersList } from "./HoldersList";
import { LimitRow } from "./LimitRow";
import {
  DEFAULT_MEMORY_MB,
  DEFAULT_SLOTS,
  NEEDS_UPDATE,
  NEW_COMMANDS_ONLY,
  supportLines,
} from "./resources-text";

const option = (value: ResourcePriority, label: string): SegmentedOption<ResourcePriority> => ({
  value,
  label,
  icon: <span className="px-1">{label}</span>,
});

const PRIORITIES = [option("off", "Off"), option("balanced", "Balanced"), option("background", "Background")];
const PRIORITY_HINT = {
  off: "Commands run at normal priority.",
  balanced: "Lower priority.",
  background: "Lowest priority, for unattended runs.",
};

const BYPASS = "A command run through process_start bypasses the queue.";

export function ResourcesGroup() {
  const settings = useSettings();
  const support = useResourceSupport();
  const supported = settings.data?.resources !== undefined && !!support.data;
  const activity = useResourceActivity(supported);
  const save = useSetResources();
  const value = settings.data?.resources;
  if (!settings.data) return null;
  const disabled = !supported || save.isPending;
  const current: ResourceSettings | undefined = value;
  const update = (patch: Partial<ResourceSettings>) => current && save.mutate({ ...current, ...patch });

  return (
    <div className="flex flex-col gap-4" data-testid="resources-group">
      {!supported && (
        <p role="status" className="text-sm text-muted-foreground">
          {NEEDS_UPDATE}
        </p>
      )}
      <SettingRow id="resources-priority">
        <Field>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Command priority</FieldLabel>
            <SegmentedControl
              aria-label="Command priority"
              value={current?.priority ?? "off"}
              options={PRIORITIES}
              onChange={(priority) => !disabled && update({ priority })}
            />
          </div>
          <FieldDescription>
            {PRIORITY_HINT[current?.priority ?? "off"]} {NEW_COMMANDS_ONLY}
          </FieldDescription>
        </Field>
      </SettingRow>
      <LimitRow
        id="resources-heavy-slots"
        label="Heavy command slots"
        description={`Only this many heavy commands (tests, builds, typechecks) run at once; the rest wait. ${NEW_COMMANDS_ONLY} ${BYPASS}`}
        unit="slots"
        value={current?.heavySlots ?? null}
        min={HEAVY_SLOTS_MIN}
        max={HEAVY_SLOTS_MAX}
        fallback={DEFAULT_SLOTS}
        disabled={disabled}
        onChange={(heavySlots) => update({ heavySlots })}
      />
      <LimitRow
        id="resources-memory-limit"
        label="Memory limit per command"
        description={`Stop a command that uses more memory than this. ${NEW_COMMANDS_ONLY}`}
        unit="MB"
        value={current?.memoryLimitMb ?? null}
        min={MEMORY_LIMIT_MIN_MB}
        fallback={DEFAULT_MEMORY_MB}
        disabled={disabled}
        onChange={(memoryLimitMb) => update({ memoryLimitMb })}
      />
      {current && (
        <AppliesToRow value={current} disabled={disabled} onChange={(appliesTo) => update({ appliesTo })} />
      )}
      {support.data && (
        <div className="text-xs text-muted-foreground" data-testid="resources-support">
          {supportLines(support.data).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      {supported && <HoldersList activity={activity.data} />}
    </div>
  );
}
