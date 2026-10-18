import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { AppError, type Core, isIconPng } from "@tau/protocol";
import type { ChangeEmitter } from "./change-emitter";
import { suggestFiles } from "./fs/suggest-files";
import type { CloneService } from "./git/clone-service";
import type { ConversationStore } from "./harness/conversation-store";
import { HOME_PROJECT_ID, type ProjectStore } from "./harness/project-store";
import type { IconService } from "./icons/icon-service";
import type { PresentProject } from "./project-view";
import {
  type RemovalHooks,
  requireNoLostWork,
  runConversationRemoved,
  runProjectRemoved,
} from "./removal-hooks";
import { requireName } from "./require-name";
import { resolveProjectFolder } from "./resolve-project-folder";

const rejectHome = (id: string, action: string) => {
  if (id === HOME_PROJECT_ID) throw new AppError("invalid_request", `The Home project cannot be ${action}.`);
};

export function createProjectsApi(deps: {
  projects: ProjectStore;
  conversations: ConversationStore;
  clones: CloneService;
  icons: IconService;
  present: PresentProject;
  removalHooks: RemovalHooks;
  changes: ChangeEmitter;
  now: () => number;
}): Core["projects"] {
  const { projects, conversations, clones, icons, present, removalHooks, changes, now } = deps;
  const nonHome = async (id: string) => {
    const project = await projects.require(id);
    return project.id === HOME_PROJECT_ID ? undefined : project;
  };
  const announce = () => changes.emit({ resource: "projects" });
  return {
    list: async () => Promise.all((await projects.list()).map(present)),
    async add({ path, name }) {
      const real = await resolveProjectFolder(path);
      const project = await projects.add({
        id: randomUUID(),
        name: name === undefined ? basename(real) : requireName(name),
        path: real,
        createdAt: now(),
      });
      announce();
      return present(project);
    },
    clone: async (input) => present(await clones.clone(input)),
    retryClone: (id) => clones.retryClone(id),
    async suggestFiles(id, query) {
      return suggestFiles((await projects.require(id)).path, query);
    },
    async icon(id) {
      const project = await nonHome(id);
      return project ? icons.icon(project) : null;
    },
    async iconCandidates(id) {
      const project = await nonHome(id);
      return project ? icons.candidates(project) : [];
    },
    async iconCandidate(id, name) {
      const project = await nonHome(id);
      if (!project) throw new AppError("not_found", "This image is not available.");
      return icons.candidate(project, name);
    },
    async setIcon(id, png) {
      if (!(await nonHome(id))) throw new AppError("invalid_request", "The Home project has a fixed icon.");
      if (png !== null && !isIconPng(png)) {
        throw new AppError("invalid_request", "The icon must be a 128x128 PNG of at most 256 KB.");
      }
      await icons.setCustom(id, png);
      announce();
    },
    async rename(id, name) {
      rejectHome(id, "renamed");
      await projects.rename(id, requireName(name));
      announce();
    },
    async remove(id) {
      rejectHome(id, "removed");
      await projects.require(id);
      const threads = await conversations.list(id);
      for (const thread of threads) await requireNoLostWork(removalHooks, thread, false);
      clones.cancel(id);
      await conversations.removeAllOfProject(id);
      for (const thread of threads) await runConversationRemoved(removalHooks, thread);
      await runProjectRemoved(removalHooks, id);
      await projects.remove(id);
      await icons.removeCustom(id);
      announce();
      changes.emit({ resource: "conversations", projectId: id });
    },
  };
}
