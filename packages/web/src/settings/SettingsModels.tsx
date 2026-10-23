import type { Settings } from "@tau/protocol";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/error-message";
import { useModels, useSettings, useSettingsSave } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { ModelSetting } from "./ModelSetting";
import { VoiceModelRow } from "./VoiceModelRow";

export function SettingsModels() {
  const api = useApi();
  const saveSettings = useSettingsSave();
  const models = useModels();
  const settings = useSettings();
  const { run, error } = useSubmit();

  if (models.isError) return <FormError message={errorMessage(models.error)} />;
  if (models.isPending || settings.isPending) return <Skeleton className="h-9 w-full" />;

  const save = (patch: Partial<Settings>, action: () => Promise<unknown>) =>
    void run(() => saveSettings(patch, action));

  return (
    <div className="flex flex-col gap-3">
      <ModelSetting
        settingId="default-model"
        label="Default model"
        models={models.data}
        model={settings.data?.defaultModel ?? null}
        level={settings.data?.defaultThinkingLevel ?? null}
        onModel={(ref) => save({ defaultModel: ref }, () => api.settings.setDefaultModel(ref))}
        onLevel={(level) =>
          save({ defaultThinkingLevel: level }, () => api.settings.setDefaultThinkingLevel(level))
        }
      />
      <p className="text-sm text-muted-foreground">
        Used for new threads; change a thread's model from its composer.
      </p>
      <ModelSetting
        settingId="fast-model"
        label="Fast model"
        models={models.data}
        model={settings.data?.fastModel ?? null}
        level={settings.data?.fastThinkingLevel ?? null}
        onModel={(ref) => save({ fastModel: ref }, () => api.settings.setFastModel(ref))}
        onLevel={(level) =>
          save({ fastThinkingLevel: level }, () => api.settings.setFastThinkingLevel(level))
        }
        clearLabel="Same as thread"
        onClear={() => save({ fastModel: null }, () => api.settings.setFastModel(null))}
      />
      <p className="text-sm text-muted-foreground">The fast model names new threads.</p>
      <VoiceModelRow />
      <FormError message={error} />
    </div>
  );
}
