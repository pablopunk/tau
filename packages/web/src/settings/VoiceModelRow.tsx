import { useQueryClient } from "@tanstack/react-query";
import type { VoiceModelSetting, VoiceOptions } from "@tau/protocol";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { SettingRow } from "@/components/ui/settings-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys, useSettings, useVoiceOptions } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";

const providerOptions = (options: VoiceOptions): ComboboxOption[] =>
  options.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      value: `${provider.provider}/${model.modelId}`,
      label: model.name,
      description: model.modelId,
      group: provider.providerName,
    })),
  );

const keyOf = (setting: Extract<VoiceModelSetting, { kind: "provider" }>) =>
  `${setting.provider}/${setting.modelId}`;

const megabytesOf = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1048576))} MB`;

function LocalDescription({
  options,
  onDelete,
  deleting,
}: {
  options: VoiceOptions;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { local } = options;
  if (local.state === "ready")
    return (
      <span className="flex flex-wrap items-center gap-2">
        Downloaded and ready.
        <Button type="button" variant="ghost" size="sm" disabled={deleting} onClick={onDelete}>
          Delete
        </Button>
      </span>
    );
  if (local.state === "downloading") {
    const progress = local.progress;
    const total = progress?.total ?? null;
    const percent = progress && total ? Math.min(99, Math.floor((progress.downloaded / total) * 100)) : null;
    return (
      <span className="flex flex-col gap-1">
        <span>
          Downloading {progress?.file ?? "model"}…
          {percent !== null && progress && total
            ? ` ${percent}% (${megabytesOf(progress.downloaded)} of ${megabytesOf(total)})`
            : null}
        </span>
        {percent !== null ? (
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </span>
        ) : null}
      </span>
    );
  }
  if (local.state === "error") return <span>Download failed{local.error ? `: ${local.error}.` : "."}</span>;
  return <span>Not downloaded yet — starts downloading when picked.</span>;
}

/**
 * Third models row: which voice transcribes composer dictation. `null` is
 * the browser fallback (built-in SpeechRecognition). Hidden on nodes that
 * predate voice support: a missing `settings.voiceModel` field or a 404 on
 * `GET /api/voice/options` (read as `null`).
 */
export function VoiceModelRow() {
  const api = useApi();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const voice = useVoiceOptions();
  const save = useSubmit();
  const remove = useSubmit();

  if (settings.isPending || voice.isPending) return <Skeleton className="h-9 w-full" />;
  // An old node sends no `voiceModel` field; an old route 404s to `null`.
  if ((settings.data && !("voiceModel" in settings.data)) || voice.data === null) return null;

  const current: VoiceModelSetting | null = settings.data?.voiceModel ?? null;
  const options = voice.data;
  const models = options ? providerOptions(options) : [];
  const selected = current?.kind === "provider" ? keyOf(current) : null;
  const selectedMissing = selected !== null && !models.some((model) => model.value === selected);
  const noProviderModels = models.length === 0;
  const value = current === null ? "browser" : current.kind;

  const choose = (setting: VoiceModelSetting | null) =>
    void save.run(async () => {
      await api.settings.setVoiceModel(setting);
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      if (setting?.kind === "local") {
        // Start the download now so the state below flips to progress.
        await queryClient.invalidateQueries({ queryKey: queryKeys.voiceOptions });
        void api.voice.warm().catch(() => undefined);
      }
    });

  const deleteDownload = () =>
    void remove.run(async () => {
      await api.voice.removeModel();
      await queryClient.invalidateQueries({ queryKey: queryKeys.voiceOptions });
    });

  return (
    <SettingRow id="voice-model" className="flex flex-col gap-2">
      <span id="voice-model-label" className="text-sm font-medium">
        Voice model
      </span>
      <div
        role="radiogroup"
        aria-labelledby="voice-model-label"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
      >
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="voice-model"
            className="accent-primary"
            checked={value === "browser"}
            disabled={save.pending}
            onChange={() => choose(null)}
          />
          Browser
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="voice-model"
            className="accent-primary"
            checked={value === "local"}
            disabled={save.pending || !options?.local.available}
            onChange={() => choose({ kind: "local" })}
          />
          Local
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="voice-model"
            className="accent-primary"
            checked={value === "provider"}
            disabled={save.pending || noProviderModels}
            onChange={() => {
              const first = models[0];
              if (first) {
                const [provider, ...rest] = first.value.split("/");
                choose({ kind: "provider", provider: provider ?? "", modelId: rest.join("/") });
              }
            }}
          />
          Provider
        </label>
      </div>
      <div className="text-sm text-muted-foreground">
        {value === "browser" ? (
          <span>Built-in speech recognition, nothing to download.</span>
        ) : value === "local" ? (
          options ? (
            <LocalDescription options={options} onDelete={deleteDownload} deleting={remove.pending} />
          ) : (
            <span>Private on-device transcription.</span>
          )
        ) : (
          <span className="flex flex-col gap-1">
            <Combobox
              aria-label="Provider voice model"
              options={models}
              value={selectedMissing ? null : selected}
              placeholder="Select a voice model…"
              disabled={noProviderModels}
              onChange={(key) => {
                const [provider, ...rest] = key.split("/");
                choose({ kind: "provider", provider: provider ?? "", modelId: rest.join("/") });
              }}
            />
          </span>
        )}
      </div>
      {noProviderModels ? (
        <p className="text-sm text-muted-foreground">No connected provider offers speech-to-text.</p>
      ) : null}
      {selectedMissing ? (
        <p className="text-sm text-muted-foreground">The saved model is no longer listed — pick another.</p>
      ) : null}
      {options?.providers.map((provider) =>
        provider.error ? (
          <p key={provider.provider} className="text-sm text-muted-foreground">
            {provider.providerName}: {provider.error}
          </p>
        ) : null,
      )}
      {voice.isError ? <p className="text-sm text-muted-foreground">Could not load voice options.</p> : null}
      <FormError message={save.error ?? remove.error} />
    </SettingRow>
  );
}
