import type { GithubRepo, Project } from "@pi-everywhere/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ProjectIcon } from "@/components/ui/project-icon";
import { RefreshReposButton } from "@/github/RefreshReposButton";
import { GITHUB_GROUP, githubOptions, parseGithubValue } from "@/github/repo-options";
import { UseRepoDialog } from "@/github/UseRepoDialog";
import { api } from "@/lib/api";
import { projectsHomeFirst } from "@/lib/new-thread-defaults";
import { queryKeys, useGithubRepos, useGithubStatus } from "@/lib/queries";
import { AddProjectDialog } from "@/sidebar/AddProjectDialog";

const PROJECTS_GROUP = "Projects";

const projectOption = (project: Project): ComboboxOption => ({
  value: project.id,
  label: project.name,
  group: PROJECTS_GROUP,
  disabled: project.status === "failed",
  icon: (
    <ProjectIcon
      id={project.id}
      name={project.name}
      iconUrl={project.iconUrl}
      home={project.kind === "home"}
    />
  ),
  ...(project.status !== "ready" && { hint: project.status }),
});

interface ProjectPickerProps {
  projects: Project[];
  projectId: string;
  onProject(id: string): void;
  disabled: boolean;
}

export function ProjectPicker({ projects, projectId, onProject, disabled }: ProjectPickerProps) {
  const queryClient = useQueryClient();
  const status = useGithubStatus();
  const repos = useGithubRepos(status.data?.state === "connected");
  const [adding, setAdding] = useState(false);
  const [dialogRepo, setDialogRepo] = useState<GithubRepo | null>(null);
  const { run, error } = useSubmit();

  const selectProject = async (project: Project) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    onProject(project.id);
  };

  const openLocalCopy = (repo: GithubRepo) =>
    run(async () => {
      await selectProject(await api.github.use({ nameWithOwner: repo.nameWithOwner, mode: "local" }));
    });

  const pickRepo = (nameWithOwner: string) => {
    const repo = repos.data?.find((candidate) => candidate.nameWithOwner === nameWithOwner);
    if (!repo) return;
    if (repo.localPath) void openLocalCopy(repo);
    else setDialogRepo(repo);
  };

  const onChange = (value: string) => {
    const repoName = parseGithubValue(value);
    if (repoName) pickRepo(repoName);
    else onProject(value);
  };

  const options = [
    ...projectsHomeFirst(projects).map(projectOption),
    ...githubOptions({ status: status.data, repos: repos.data, reposFailed: repos.isError }),
  ];

  return (
    <>
      <Combobox
        aria-label="Project"
        variant="ghost"
        size="sm"
        className="w-auto min-w-0 max-w-full"
        contentClassName="w-[min(32rem,calc(100vw-2rem))]"
        disabled={disabled}
        options={options}
        value={projectId}
        onChange={onChange}
        onOpenChange={(open) =>
          open && void queryClient.invalidateQueries({ queryKey: queryKeys.githubRepos })
        }
        footer={(close) => (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start font-normal"
            onClick={() => {
              close();
              setAdding(true);
            }}
          >
            <PlusIcon />
            Add project…
          </Button>
        )}
        groupActions={
          status.data?.state === "connected" ? { [GITHUB_GROUP]: <RefreshReposButton /> } : undefined
        }
      />
      <FormError message={error} className="w-full" />
      {adding && (
        <AddProjectDialog
          onClose={() => setAdding(false)}
          onAdded={(project) => void selectProject(project)}
        />
      )}
      <UseRepoDialog
        repo={dialogRepo}
        onClose={() => setDialogRepo(null)}
        onUsed={(project) => {
          setDialogRepo(null);
          void selectProject(project);
        }}
      />
    </>
  );
}
