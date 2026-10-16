import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { AppError, type Core } from "@pi-everywhere/protocol";
import type { ChangeEmitter } from "./change-emitter";
import type { CloneService } from "./git/clone-service";
import type { ConversationStore } from "./harness/conversation-store";
import { HOME_PROJECT_ID, type ProjectStore } from "./harness/project-store";
import { requireName } from "./require-name";
import { resolveProjectFolder } from "./resolve-project-folder";

const rejectHome = (id: string, action: string) => {
  if (id === HOME_PROJECT_ID) throw new AppError("invalid_request", `The Home project cannot be ${action}.`);
};

export function createProjectsApi(deps: {
  projects: ProjectStore;
  conversations: ConversationStore;
  clones: CloneService;
  changes: ChangeEmitter;
  now: () => number;
}): Core["projects"] {
  const { projects, conversations, clones, changes, now } = deps;
  const announce = () => changes.emit({ resource: "projects" });
  return {
    list: () => projects.list(),
    async add({ path, name }) {
      const real = await resolveProjectFolder(path);
      const project = await projects.add({
        id: randomUUID(),
        name: name === undefined ? basename(real) : requireName(name),
        path: real,
        createdAt: now(),
      });
      announce();
      return project;
    },
    clone: (input) => clones.clone(input),
    retryClone: (id) => clones.retryClone(id),
    async rename(id, name) {
      rejectHome(id, "renamed");
      await projects.rename(id, requireName(name));
      announce();
    },
    async remove(id) {
      rejectHome(id, "removed");
      await projects.require(id);
      clones.cancel(id);
      await conversations.removeAllOfProject(id);
      await projects.remove(id);
      announce();
    },
  };
}
