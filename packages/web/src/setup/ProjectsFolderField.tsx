import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { queryKeys, useSettings } from "@/lib/queries";

export function ProjectsFolderField() {
  const id = useId();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const { run, error, pending } = useSubmit();
  const saved = settings.data?.projectsFolder ?? "";
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);

  const save = () =>
    run(async () => {
      await api.settings.setProjectsFolder(value.trim());
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    });

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        Projects folder
      </label>
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(event) => setValue(event.target.value)} />
        <Button type="submit" variant="outline" disabled={pending || !value.trim() || value.trim() === saved}>
          Save
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Cloned repositories live here. If this folder is inside the pi-everywhere data home, deleting the data
        home deletes them too.
      </p>
      <FormError message={error} />
    </form>
  );
}
