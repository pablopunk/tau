import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Core } from "@pi-everywhere/protocol";
import type { ChangeEmitter } from "./change-emitter";
import type { ConversationStore } from "./harness/conversation-store";
import type { ProjectStore } from "./harness/project-store";
import { requireName } from "./require-name";
import { resolveProjectFolder } from "./resolve-project-folder";

export function createProjectsApi(deps: {
  projects: ProjectStore;
  conversations: ConversationStore;
  changes: ChangeEmitter;
  now: () => number;
}): Core["projects"] {
  const { projects, conversations, changes, now } = deps;
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
    async rename(id, name) {
      await projects.rename(id, requireName(name));
      announce();
    },
    async remove(id) {
      await projects.require(id);
      await conversations.abortAllOfProject(id);
      await projects.remove(id);
      announce();
    },
  };
}
