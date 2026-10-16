import { useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { queryKeys, useModels, useSettings } from "@/lib/queries";
import { ModelCombobox } from "./ModelCombobox";

export function ModelStep() {
  const id = useId();
  const queryClient = useQueryClient();
  const models = useModels();
  const settings = useSettings();
  const { run, error } = useSubmit();

  if (models.isError) return <FormError message={errorMessage(models.error)} />;
  if (models.isPending || settings.isPending) return <Skeleton className="h-9 w-full" />;

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={id} className="text-sm font-medium">
        Default model
      </label>
      <ModelCombobox
        id={id}
        models={models.data}
        value={settings.data?.defaultModel ?? null}
        onChange={(ref) =>
          void run(async () => {
            await api.settings.setDefaultModel(ref);
            await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
          })
        }
      />
      <p className="text-sm text-muted-foreground">
        Changing the default model only affects new conversations. Existing ones keep their model.
      </p>
      <FormError message={error} />
    </div>
  );
}
