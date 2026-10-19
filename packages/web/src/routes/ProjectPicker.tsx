import { useQueryClient } from "@tanstack/react-query";
import type { GithubRepo, Project } from "@tau/protocol";
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
import { projectsHomeFirst } from "@/lib/new-thread-defaults";
import { queryKeys, useGithubRepos, useGithubStatus } from "@/lib/queries";
import { type MachineData, MachineProvider, useHubQueryClient, useMachinesData } from "@/machines";
import { useApi, useMachineId } from "@/machines/machine-context";
import { AddProjectDialog } from "@/sidebar/AddProjectDialog";
import { ChooseMachineDialog } from "./ChooseMachineDialog";

const PROJECTS_GROUP = "Projects";

const OTHER_MACHINE = "machine:";
const otherValue = (machineId: string, projectId: string) => `${OTHER_MACHINE}${machineId}:${projectId}`;

const projectOption = (project: Project, group = PROJECTS_GROUP, value = project.id): ComboboxOption => ({
  value,
  label: project.name,
  group,
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
  /** Another machine's project was picked (or added): the page re-scopes to that machine. */
  onMachineProject?: (machineId: string | undefined, projectId: string) => void;
}

function usePickerMachines(): { all: MachineData[]; groupOf: (machine: MachineData) => string } {
  const all = useMachinesData();
  const groupOf = (machine: MachineData) => (all.length > 1 ? machine.name : PROJECTS_GROUP);
  return { all, groupOf };
}

export function ProjectPicker({
  projects,
  projectId,
  onProject,
  disabled,
  onMachineProject,
}: ProjectPickerProps) {
  const api = useApi();
  const machineId = useMachineId();
  const { all, groupOf } = usePickerMachines();
  const hub = useHubQueryClient();
  const current = all.find((machine) => machine.machineId === machineId);
  const others = all.filter((machine) => machine.machineId !== machineId);
  const [choosing, setChoosing] = useState(false);
  const [addingOn, setAddingOn] = useState<{ machineId: string | undefined } | null>(null);
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
    if (value.startsWith(OTHER_MACHINE)) {
      const [, otherMachine = "", ...rest] = value.split(":");
      return void onMachineProject?.(otherMachine, rest.join(":"));
    }
    const repoName = parseGithubValue(value);
    if (repoName) pickRepo(repoName);
    else onProject(value);
  };

  const options = [
    ...projectsHomeFirst(projects).map((project) =>
      projectOption(project, current ? groupOf(current) : PROJECTS_GROUP),
    ),
    ...others.flatMap((machine) =>
      projectsHomeFirst([...machine.projects]).map((project) =>
        projectOption(project, groupOf(machine), otherValue(machine.machineId ?? "", project.id)),
      ),
    ),
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
              if (all.length > 1) setChoosing(true);
              else setAdding(true);
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
      {choosing && (
        <ChooseMachineDialog
          machines={all}
          onClose={() => setChoosing(false)}
          onChoose={(chosen) => {
            setChoosing(false);
            if (chosen === machineId) setAdding(true);
            else setAddingOn({ machineId: chosen });
          }}
        />
      )}
      {addingOn && (
        <MachineProvider key={addingOn.machineId ?? "local"} machineId={addingOn.machineId}>
          <AddProjectDialog
            onClose={() => setAddingOn(null)}
            onAdded={(project) => {
              void hub.invalidateQueries({ queryKey: queryKeys.projects });
              void hub.invalidateQueries({ queryKey: ["machine-data"] });
              onMachineProject?.(addingOn.machineId, project.id);
            }}
          />
        </MachineProvider>
      )}
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
