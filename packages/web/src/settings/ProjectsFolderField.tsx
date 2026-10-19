import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import { PathInput } from "@/components/ui/path-input";
import { SettingRow } from "@/components/ui/settings-layout";
import { queryKeys, useSettings } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { useOnNode } from "@/nodes/use-on-node";

export function ProjectsFolderField() {
  const api = useApi();
  const onNode = useOnNode();
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
    <SettingRow id="projects-folder" asChild>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label htmlFor={id} className="text-sm font-medium">
          Projects folder{onNode}
        </label>
        <div className="flex gap-2">
          <PathInput id={id} value={value} onValueChange={setValue} placeholder="~/projects" />
          <Button
            type="submit"
            variant="outline"
            disabled={pending || !value.trim() || value.trim() === saved}
          >
            Save
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Cloned repositories live here. If this folder is inside the tau data home, deleting the data home
          deletes them too.
        </p>
        <FormError message={error} />
      </form>
    </SettingRow>
  );
}
