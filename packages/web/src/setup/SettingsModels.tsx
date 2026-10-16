import type { ModelRef } from "@pi-everywhere/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { queryKeys, useModels, useSettings } from "@/lib/queries";
import { ModelCombobox } from "./ModelCombobox";

export function SettingsModels() {
  const defaultId = useId();
  const fastId = useId();
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
      <label htmlFor={defaultId} className="text-sm font-medium">
        Default model
      </label>
      <ModelCombobox
        id={defaultId}
        models={models.data}
        value={settings.data?.defaultModel ?? null}
        onChange={(ref: ModelRef) => save(() => api.settings.setDefaultModel(ref))}
      />
      <label htmlFor={fastId} className="text-sm font-medium">
        Fast model
      </label>
      <ModelCombobox
        id={fastId}
        models={models.data}
        value={settings.data?.fastModel ?? null}
        onChange={(ref: ModelRef) => save(() => api.settings.setFastModel(ref))}
        clearLabel="Same as thread"
        onClear={() => save(() => api.settings.setFastModel(null))}
      />
      <p className="text-sm text-muted-foreground">
        The fast model names new threads. Models only affect new threads. Existing ones keep theirs.
      </p>
      <FormError message={error} />
    </div>
  );
}
