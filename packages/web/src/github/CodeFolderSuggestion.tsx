import { useQueryClient } from "@tanstack/react-query";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { queryKeys, useSettings, useSuggestedCodeFolder } from "@/lib/queries";

export function CodeFolderSuggestion() {
  const queryClient = useQueryClient();
  const suggestion = useSuggestedCodeFolder();
  const settings = useSettings();
  const { run, error, pending } = useSubmit();
  const path = suggestion.data?.path;
  if (!path || settings.data?.projectsFolder === path) return null;

  const accept = () =>
    run(async () => {
      await api.settings.setProjectsFolder(path);
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    });

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => void accept()}>
        Use {path} as your code folder
      </Button>
      <FormError message={error} />
    </div>
  );
}
