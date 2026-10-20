import type { CompactionSettings, ProviderInfo } from "@tau/protocol";
import { FormError } from "@/app/FormError";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { SettingRow } from "@/components/ui/settings-layout";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/error-message";
import { useProviders, useSetCompaction, useSettings } from "@/lib/queries";
import {
  FAST_COMPACTION_BACKEND_LABEL,
  FAST_COMPACTION_BLURB,
  FAST_COMPACTION_CONNECT_HINT,
  FAST_COMPACTION_LABEL,
  FAST_COMPACTION_OFFLINE_NOTE,
} from "./fast-compaction-text";

type DecisionBackend = "typesafe" | "openai";

const BACKENDS: readonly DecisionBackend[] = ["typesafe", "openai"];

const FALLBACK_NAMES: Record<DecisionBackend, string> = { typesafe: "TypeSafe", openai: "OpenAI" };

const backendOption = (value: CompactionSettings["backend"], label: string): SegmentedOption<CompactionSettings["backend"]> => ({
  value,
  label,
  icon: <span className="px-1">{label}</span>,
});

const BACKEND_OPTIONS = [
  backendOption("auto", "Auto"),
  backendOption("typesafe", "TypeSafe"),
  backendOption("openai", "OpenAI"),
];

const isReady = (info: ProviderInfo | undefined): boolean =>
  info?.connection !== null && info?.connection !== undefined && info.decisions === "ready";

function statusOf(info: ProviderInfo | undefined): string {
  if (!info || info.connection === null) return "Not connected";
  switch (info.decisions) {
    case "ready":
      return "Ready";
    case "unavailable":
      return "No decisions access";
    case "checking":
      return "Checking…";
    default:
      return "Unknown";
  }
}

/** Fast-compaction opt-in: a toggle plus a backend picker, dimmed until a decisions backend is ready. */
export function FastCompactionGroup() {
  const settings = useSettings();
  const providers = useProviders();
  const save = useSetCompaction();
  if (!settings.data) return null;
  const value: CompactionSettings = settings.data.compaction ?? { mode: "summary", backend: "auto" };
  const on = value.mode === "fast";
  const infos = new Map((providers.data ?? []).map((info) => [info.id, info]));
  const available = BACKENDS.some((id) => isReady(infos.get(id)));
  const offlineWhileOn = on && !available;
  const locked = !available && !on;
  const controlsDisabled = locked || save.isPending;

  const update = (next: CompactionSettings) => {
    if (save.isPending) return;
    save.mutate(next);
  };

  const toggle = (
    <Switch
      aria-label={FAST_COMPACTION_LABEL}
      checked={on}
      disabled={controlsDisabled}
      onCheckedChange={(checked) => !controlsDisabled && update({ ...value, mode: checked ? "fast" : "summary" })}
    />
  );

  return (
    <SettingRow id="fast-compaction" className={offlineWhileOn ? "opacity-60" : undefined}>
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>{FAST_COMPACTION_LABEL}</FieldLabel>
          {locked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-not-allowed">{toggle}</span>
              </TooltipTrigger>
              <TooltipContent>{FAST_COMPACTION_CONNECT_HINT}</TooltipContent>
            </Tooltip>
          ) : (
            toggle
          )}
        </div>
        <FieldDescription>{available ? FAST_COMPACTION_BLURB : FAST_COMPACTION_CONNECT_HINT}</FieldDescription>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>{FAST_COMPACTION_BACKEND_LABEL}</FieldLabel>
          <div className={locked ? "pointer-events-none opacity-50" : undefined}>
            <SegmentedControl
              aria-label={FAST_COMPACTION_BACKEND_LABEL}
              value={value.backend}
              options={BACKEND_OPTIONS}
              onChange={(backend) => !controlsDisabled && update({ ...value, backend })}
            />
          </div>
        </div>
        <FieldDescription>
          {BACKENDS.map((id) => `${infos.get(id)?.name ?? FALLBACK_NAMES[id]}: ${statusOf(infos.get(id))}`).join(" · ")}
        </FieldDescription>
        {offlineWhileOn && (
          <FieldDescription role="status">{FAST_COMPACTION_OFFLINE_NOTE}</FieldDescription>
        )}
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </Field>
    </SettingRow>
  );
}
