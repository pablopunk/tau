import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { queryKeys, useSettings } from "@/lib/queries";

type Mode = "folder" | "git";

/** Mount it only while open so its fields reset each time. */
export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const pathId = useId();
  const urlId = useId();
  const nameId = useId();
  const [mode, setMode] = useState<Mode>("folder");
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const projectsFolder = useSettings().data?.projectsFolder;
  const { run, error, pending, clearError } = useSubmit();
  const source = mode === "folder" ? path : url;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const added = await run(async () => {
      const trimmedName = name.trim();
      const optionalName = trimmedName ? { name: trimmedName } : {};
      if (mode === "folder") await api.projects.add({ path: path.trim(), ...optionalName });
      else await api.projects.clone({ url: url.trim(), ...optionalName });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    });
    if (added) onClose();
  };

  const changeMode = (next: string) => {
    setMode(next as Mode);
    clearError();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add project</DialogTitle>
            <DialogDescription>Use a folder on this computer or clone a Git repository.</DialogDescription>
          </DialogHeader>
          <Tabs value={mode} onValueChange={changeMode}>
            <TabsList>
              <TabsTrigger value="folder">Folder</TabsTrigger>
              <TabsTrigger value="git">Git URL</TabsTrigger>
            </TabsList>
            <TabsContent value="folder" className="flex flex-col gap-2">
              <label htmlFor={pathId} className="text-sm font-medium">
                Folder path
              </label>
              <Input
                id={pathId}
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/Users/you/src/my-app"
                spellCheck={false}
                autoFocus
                aria-invalid={error ? true : undefined}
              />
            </TabsContent>
            <TabsContent value="git" className="flex flex-col gap-2">
              <label htmlFor={urlId} className="text-sm font-medium">
                Repository URL
              </label>
              <Input
                id={urlId}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/you/my-app.git"
                spellCheck={false}
                autoFocus
                aria-invalid={error ? true : undefined}
              />
              {projectsFolder && (
                <p className="text-xs text-muted-foreground">Clones into {projectsFolder}</p>
              )}
            </TabsContent>
          </Tabs>
          <FormError message={error} />
          <div className="flex flex-col gap-2">
            <label htmlFor={nameId} className="text-sm font-medium">
              Name <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || source.trim() === ""}>
              {mode === "folder" ? "Add project" : "Clone project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
