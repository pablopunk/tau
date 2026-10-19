import { useQueryClient } from "@tanstack/react-query";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/error-message";
import { queryKeys, useModels, useSettings } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { ModelSetting } from "./ModelSetting";

export function SettingsModels() {
  const api = useApi();
  const queryClient = useQueryClient();
  const models = useModels();
  const settings = useSettings();
  const { run, error } = useSubmit();

  if (models.isError) return <FormError message={errorMessage(models.error)} />;
  if (models.isPending || settings.isPending) return <Skeleton className="h-9 w-full" />;

  const save = (action: () => Promise<void>) =>
    void run(async () => {
      await action();
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    });

  return (
    <div className="flex flex-col gap-3">
      <ModelSetting
        settingId="default-model"
        label="Default model"
        models={models.data}
        model={settings.data?.defaultModel ?? null}
        level={settings.data?.defaultThinkingLevel ?? null}
        onModel={(ref) => save(() => api.settings.setDefaultModel(ref))}
        onLevel={(level) => save(() => api.settings.setDefaultThinkingLevel(level))}
      />
      <ModelSetting
        settingId="fast-model"
        label="Fast model"
        models={models.data}
        model={settings.data?.fastModel ?? null}
        level={settings.data?.fastThinkingLevel ?? null}
        onModel={(ref) => save(() => api.settings.setFastModel(ref))}
        onLevel={(level) => save(() => api.settings.setFastThinkingLevel(level))}
        clearLabel="Same as thread"
        onClear={() => save(() => api.settings.setFastModel(null))}
      />
      <p className="text-sm text-muted-foreground">
        The fast model names new threads. The default model and its thinking level are used for new threads;
        change a thread's model from its composer.
      </p>
      <FormError message={error} />
    </div>
  );
}
