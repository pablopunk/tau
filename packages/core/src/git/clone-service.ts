import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";
import type { Harness } from "@earendil-works/pi-durable";
import { AppError, type Project } from "@pi-everywhere/protocol";
import type { ChangeEmitter } from "../change-emitter";
import type { ProjectStore } from "../harness/project-store";
import type { SettingsStore } from "../home/settings-store";
import { requireName } from "../require-name";
import { claimFolder } from "./claim-folder";
import { checkGitUrl, folderNameOf } from "./git-url";
import { repositoryKey } from "./repository-key";
import { type CloneRun, startClone } from "./run-clone";

export interface CloneServiceDeps {
  readonly harness: Harness;
  readonly projects: ProjectStore;
  readonly settings: SettingsStore;
  readonly changes: ChangeEmitter;
  readonly now: () => number;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly allowFileClones: boolean;
  /** Extra `git` arguments (`["-c", "key=value", ...]`) for cloning this URL; none by default. */
  readonly extraGitConfig?: (url: string) => string[];
}

export interface CloneService {
  clone(input: { url: string; name?: string }): Promise<Project>;
  retryClone(id: string): Promise<void>;
  /** Kills a running clone of this project, if any. */
  cancel(id: string): void;
  /** Kills every running clone. */
  stopAll(): void;
  /** Marks interrupted clones as failed and deletes their claimed folders. */
  recoverAtStartup(): Promise<void>;
}

const INTERRUPTED = "Interrupted by a restart";

async function requireGit(env: CloneServiceDeps["env"]): Promise<void> {
  await promisify(execFile)("git", ["--version"], { env }).catch(() => {
    throw new AppError("git_missing", "Git is not installed or not on the PATH.");
  });
}

const PLACEHOLDER_RUN: CloneRun = { done: new Promise(() => {}), kill() {} };

const removeFolder = (path: string) => rm(path, { recursive: true, force: true });

export function createCloneService(deps: CloneServiceDeps): CloneService {
  const { projects, settings, changes, now, env, allowFileClones } = deps;
  const extraGitConfig = deps.extraGitConfig ?? (() => []);
  const running = new Map<string, CloneRun>();
  const announce = () => changes.emit({ resource: "projects" });

  const settle = async (id: string, directory: string, outcome: Awaited<CloneRun["done"]>) => {
    if (outcome.ok) {
      const path = await realpath(directory);
      running.delete(id);
      if (await projects.setCloneState(id, { status: "ready", path })) return;
      return removeFolder(directory);
    }
    await removeFolder(directory);
    running.delete(id);
    await projects.setCloneState(id, { status: "failed", error: outcome.error });
  };

  const begin = (id: string, url: string, directory: string) => {
    const run = startClone({ url, directory, env, allowFileClones, extraGitConfig: extraGitConfig(url) });
    running.set(id, run);
    void run.done
      .then((outcome) => settle(id, directory, outcome))
      .catch((error) => console.error("pi-everywhere: clone bookkeeping failed", error))
      .finally(() => {
        if (running.get(id) === run) running.delete(id);
        announce();
      });
  };

  const projectsRoot = async () => {
    const { projectsFolder } = await settings.get();
    await mkdir(projectsFolder, { recursive: true });
    return realpath(projectsFolder);
  };

  const requireNoDuplicate = async (url: string) => {
    const key = repositoryKey(url);
    const taken = (await projects.list()).some(
      (project) => project.gitUrl !== undefined && repositoryKey(project.gitUrl) === key,
    );
    if (taken) throw new AppError("duplicate_project", "This repository is already a project.");
  };

  return {
    async clone({ url, name }) {
      await requireGit(env);
      const normalized = checkGitUrl(url, allowFileClones);
      const projectName = name === undefined ? folderNameOf(normalized) : requireName(name);
      await requireNoDuplicate(url);
      const directory = await claimFolder(await projectsRoot(), folderNameOf(normalized));
      try {
        const project = await projects.addGit({
          id: randomUUID(),
          name: projectName,
          path: directory,
          createdAt: now(),
          gitUrl: url,
        });
        announce();
        begin(project.id, url, directory);
        return project;
      } catch (error) {
        await removeFolder(directory);
        throw error;
      }
    },

    async retryClone(id) {
      const project = await projects.require(id);
      if (project.kind !== "git" || project.status !== "failed" || running.has(id) || !project.gitUrl) {
        throw new AppError("invalid_request", "Only a failed clone can be retried.");
      }
      await requireGit(env);
      running.set(id, PLACEHOLDER_RUN);
      try {
        await mkdir(dirname(project.path), { recursive: true });
        const directory = await claimFolder(dirname(project.path), basename(project.path));
        await projects.setCloneState(id, { status: "cloning", path: directory });
        announce();
        begin(id, project.gitUrl, directory);
      } catch (error) {
        running.delete(id);
        throw error;
      }
    },

    cancel: (id) => running.get(id)?.kill(),
    stopAll() {
      for (const run of running.values()) run.kill();
    },

    async recoverAtStartup() {
      const interrupted = (await projects.list()).filter((project) => project.status === "cloning");
      for (const project of interrupted) {
        await projects.setCloneState(project.id, { status: "failed", error: INTERRUPTED });
        await removeFolder(project.path);
      }
      if (interrupted.length > 0) announce();
    },
  };
}
