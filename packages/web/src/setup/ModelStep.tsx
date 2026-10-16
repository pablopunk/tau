import type { ModelRef } from "@pi-everywhere/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { queryKeys, useModels } from "@/lib/queries";
import { ModelCombobox } from "./ModelCombobox";

export function ModelStep() {
  const defaultId = useId();
  const fastId = useId();
  const queryClient = useQueryClient();
  const models = useModels();
  const { run, error, pending } = useSubmit();
  const [defaultModel, setDefaultModel] = useState<ModelRef | null>(null);
  const [fastModel, setFastModel] = useState<ModelRef | null>(null);

  if (models.isError) return <FormError message={errorMessage(models.error)} />;
  if (models.isPending) return <Skeleton className="h-9 w-full" />;

  const submit = () =>
    run(async () => {
      if (!defaultModel) return;
      await api.settings.setFastModel(fastModel);
      await api.settings.setDefaultModel(defaultModel);
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={defaultId} className="text-sm font-medium">
        Default model
      </label>
      <ModelCombobox id={defaultId} models={models.data} value={defaultModel} onChange={setDefaultModel} />
      <label htmlFor={fastId} className="text-sm font-medium">
        Fast model (optional)
      </label>
      <ModelCombobox
        id={fastId}
        models={models.data}
        value={fastModel}
        onChange={setFastModel}
        clearLabel="Same as thread"
        onClear={() => setFastModel(null)}
      />
      <p className="text-sm text-muted-foreground">
        The fast model names new threads. Changing the default model only affects new conversations. Existing
        ones keep their model.
      </p>
      <FormError message={error} />
      <Button type="submit" disabled={!defaultModel || pending}>
        Continue
      </Button>
    </form>
  );
}
