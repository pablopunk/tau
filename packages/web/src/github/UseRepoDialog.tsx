import type { GithubRepo, Project } from "@tau/protocol";
import { useState } from "react";
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
import { PathInput } from "@/components/ui/path-input";
import { useApi } from "@/machines/machine-context";
import { useOnMachine } from "@/machines/use-on-machine";

type Mode = "clone" | "folder";

interface UseRepoDialogProps {
  repo: GithubRepo | null;
  onClose(): void;
  onUsed(project: Project): void;
}

export function UseRepoDialog({ repo, onClose, onUsed }: UseRepoDialogProps) {
  return (
    <Dialog open={repo !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{repo ? <UseRepoForm repo={repo} onUsed={onUsed} /> : null}</DialogContent>
    </Dialog>
  );
}

function UseRepoForm({ repo, onUsed }: { repo: GithubRepo; onUsed(project: Project): void }) {
  const api = useApi();
  const onMachine = useOnMachine();
  const [mode, setMode] = useState<Mode>("clone");
  const [path, setPath] = useState("");
  const [claimed, setClaimed] = useState<Project | null>(null);
  const { run, error, pending } = useSubmit();

  const submit = () =>
    run(async () => {
      const project = await api.github.use({
        nameWithOwner: repo.nameWithOwner,
        mode,
        ...(mode === "folder" && { path: path.trim() }),
      });
      if (mode === "clone") setClaimed(project);
      else onUsed(project);
    });

  if (claimed) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Cloning {repo.nameWithOwner}</DialogTitle>
          <DialogDescription>Cloning into {claimed.path}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={() => onUsed(claimed)}>
            Continue
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Use {repo.nameWithOwner}</DialogTitle>
        <DialogDescription>This repository has no copy in your code folder yet.</DialogDescription>
      </DialogHeader>
      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === "clone" ? "default" : "outline"}
          onClick={() => setMode("clone")}
        >
          Clone
        </Button>
        <Button
          type="button"
          variant={mode === "folder" ? "default" : "outline"}
          onClick={() => setMode("folder")}
        >
          Use an existing folder
        </Button>
      </div>
      {mode === "folder" ? (
        <PathInput
          aria-label={`Folder path${onMachine}`}
          placeholder="~/path/to/repo"
          value={path}
          onValueChange={setPath}
        />
      ) : null}
      <FormError message={error} />
      <DialogFooter>
        <Button type="submit" disabled={pending || (mode === "folder" && !path.trim())}>
          {mode === "clone" ? "Clone now" : "Use folder"}
        </Button>
      </DialogFooter>
    </form>
  );
}
