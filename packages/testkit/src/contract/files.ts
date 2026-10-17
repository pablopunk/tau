import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const MAX_SUGGESTIONS = 20;

export function fileCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("files", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    async function projectWithFiles(names: readonly string[]) {
      const project = await target.core.projects.add({ path: await target.paths.directory("files") });
      for (const name of names) await target.writeProjectFile?.(project.path, name, "content");
      return project;
    }

    test("[files] suggests files and the folders they live in, best match first", async () => {
      const project = await projectWithFiles(["README.md", "src/app.ts", "src/util/helpers.ts"]);
      const byName = await target.core.projects.suggestFiles(project.id, "app");
      expect(byName[0]).toEqual({ path: "src/app.ts", kind: "file" });
      const byFolder = await target.core.projects.suggestFiles(project.id, "util");
      expect(byFolder).toContainEqual({ path: "src/util", kind: "directory" });
      expect(byFolder).toContainEqual({ path: "src/util/helpers.ts", kind: "file" });
    });

    test("[files] answers at most 20 suggestions", async () => {
      const names = Array.from({ length: 30 }, (_, index) => `many/file-${index}.txt`);
      const project = await projectWithFiles(names);
      expect((await target.core.projects.suggestFiles(project.id, "file")).length).toBe(MAX_SUGGESTIONS);
    });

    test("[files] answers nothing for a query that leaves the project folder", async () => {
      const project = await projectWithFiles(["src/app.ts"]);
      for (const query of ["../", "src/../..", "/etc", "~/"]) {
        expect(await target.core.projects.suggestFiles(project.id, query)).toEqual([]);
      }
    });

    test("[files] rejects an unknown project with not_found", async () => {
      await rejectsWithCode(target.core.projects.suggestFiles("nope", "a"), "not_found");
    });
  });
}
