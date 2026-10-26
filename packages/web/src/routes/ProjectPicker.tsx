import { useQueryClient } from "@tanstack/react-query";
import type { GithubRepo, Project } from "@tau/protocol";
import { PlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { NodeAvatar } from "@/components/ui/node-avatar";
import { ProjectIcon } from "@/components/ui/project-icon";
import { RefreshReposButton } from "@/github/RefreshReposButton";
import { GITHUB_GROUP, githubOptions, parseGithubValue } from "@/github/repo-options";
import { UseRepoDialog } from "@/github/UseRepoDialog";
import { projectsHomeFirst } from "@/lib/new-thread-defaults";
import { nodeAssetUrl } from "@/lib/paths";
import { queryKeys, useGithubRepos, useGithubStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { type NodeData, NodeProvider, useHubQueryClient, useNodesData } from "@/nodes";
import { useApi, useNodeId } from "@/nodes/node-context";
import { AddProjectDialog } from "@/sidebar/AddProjectDialog";
import { ChooseNodeDialog } from "@/sidebar/ChooseNodeDialog";

const PROJECTS_GROUP = "Projects";

const OTHER_NODE = "node:";
const otherValue = (nodeId: string, projectId: string) => `${OTHER_NODE}${nodeId}:${projectId}`;

const projectOption = (
  project: Project,
  group = PROJECTS_GROUP,
  value = project.id,
  nodeId?: string,
): ComboboxOption => ({
  value,
  label: project.name,
  group,
  disabled: project.status === "failed",
  icon: (
    <ProjectIcon
      id={project.id}
      name={project.name}
      iconUrl={project.iconUrl ? nodeAssetUrl(project.iconUrl, nodeId) : null}
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
  className?: string;
  /** Another node's project was picked (or added): the page re-scopes to that node. */
  onNodeProject?: (nodeId: string | undefined, projectId: string) => void;
}

function usePickerNodes(): { all: NodeData[]; groupOf: (node: NodeData) => string } {
  const all = useNodesData();
  const groupOf = (node: NodeData) =>
    all.length > 1 ? (node.local ? `${node.name} · local` : node.name) : PROJECTS_GROUP;
  return { all, groupOf };
}

export function ProjectPicker({
  projects,
  projectId,
  onProject,
  disabled,
  className,
  onNodeProject,
}: ProjectPickerProps) {
  const api = useApi();
  const nodeId = useNodeId();
  const { all, groupOf } = usePickerNodes();
  const hub = useHubQueryClient();
  const current = all.find((node) => node.nodeId === nodeId);
  const others = all.filter((node) => node.nodeId !== nodeId);
  const [choosing, setChoosing] = useState(false);
  const [addingOn, setAddingOn] = useState<{ nodeId: string | undefined } | null>(null);
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
    if (value.startsWith(OTHER_NODE)) {
      const [, otherNode = "", ...rest] = value.split(":");
      return void onNodeProject?.(otherNode, rest.join(":"));
    }
    const repoName = parseGithubValue(value);
    if (repoName) pickRepo(repoName);
    else onProject(value);
  };

  const groupIcons: Record<string, ReactNode> =
    all.length > 1
      ? Object.fromEntries(
          all.map((node) => [
            groupOf(node),
            <NodeAvatar key={node.name} os={node.os} status={node.status} />,
          ]),
        )
      : {};

  const selected = projects.find((project) => project.id === projectId);
  const selectedIcon = selected ? (
    <ProjectIcon
      id={selected.id}
      name={selected.name}
      iconUrl={selected.iconUrl ? nodeAssetUrl(selected.iconUrl, nodeId) : null}
      home={selected.kind === "home"}
      tile={24}
    />
  ) : undefined;

  const options = [
    ...projectsHomeFirst(projects).map((project) =>
      projectOption(project, current ? groupOf(current) : PROJECTS_GROUP, project.id, nodeId),
    ),
    ...others.flatMap((node) =>
      projectsHomeFirst([...node.projects]).map((project) =>
        projectOption(project, groupOf(node), otherValue(node.nodeId ?? "", project.id), node.nodeId),
      ),
    ),
    ...githubOptions({ status: status.data, repos: repos.data, reposFailed: repos.isError }),
  ];

  return (
    <>
      <Combobox
        aria-label="Project"
        triggerIcon={selectedIcon}
        variant="ghost"
        size="sm"
        className={cn("w-auto min-w-0 max-w-full", className)}
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
        groupIcons={groupIcons}
        groupActions={
          status.data?.state === "connected" ? { [GITHUB_GROUP]: <RefreshReposButton /> } : undefined
        }
      />
      <FormError message={error} className="w-full" />
      {choosing && (
        <ChooseNodeDialog
          nodes={all}
          onClose={() => setChoosing(false)}
          onChoose={(chosen) => {
            setChoosing(false);
            if (chosen === nodeId) setAdding(true);
            else setAddingOn({ nodeId: chosen });
          }}
        />
      )}
      {addingOn && (
        <NodeProvider key={addingOn.nodeId ?? "local"} nodeId={addingOn.nodeId}>
          <AddProjectDialog
            onClose={() => setAddingOn(null)}
            onAdded={(project) => {
              void hub.invalidateQueries({ queryKey: queryKeys.projects });
              void hub.invalidateQueries({ queryKey: ["node-data"] });
              onNodeProject?.(addingOn.nodeId, project.id);
            }}
          />
        </NodeProvider>
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
