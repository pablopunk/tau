import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectChanges, rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function projectCases(make: MakeContractTarget): void {
  describe("projects", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    it("adds a project named after its folder, and lists it", async () => {
      const { core, paths } = target;
      const path = await paths.directory("alpha");
      const project = await core.projects.add({ path });
      expect(project).toMatchObject({ name: "alpha", createdAt: expect.any(Number) });
      expect(project.id).toEqual(expect.any(String));
      expect(await core.projects.list()).toEqual([project]);
    });

    it("uses the given name", async () => {
      const { core, paths } = target;
      const project = await core.projects.add({ path: await paths.directory("beta"), name: "Beta" });
      expect(project.name).toBe("Beta");
    });

    it("keeps projects in creation order", async () => {
      const { core, paths } = target;
      const first = await core.projects.add({ path: await paths.directory("one") });
      const second = await core.projects.add({ path: await paths.directory("two") });
      expect((await core.projects.list()).map((project) => project.id)).toEqual([first.id, second.id]);
    });

    it("rejects a duplicate, a missing path and a file", async () => {
      const { core, paths } = target;
      const path = await paths.directory("alpha");
      await core.projects.add({ path });
      await rejectsWithCode(core.projects.add({ path }), "duplicate_project");
      await rejectsWithCode(core.projects.add({ path: paths.missing() }), "path_not_found");
      await rejectsWithCode(core.projects.add({ path: await paths.file("notes.txt") }), "not_a_directory");
    });

    it("renames and removes a project", async () => {
      const { core, paths } = target;
      const project = await core.projects.add({ path: await paths.directory("alpha") });
      await core.projects.rename(project.id, "Renamed");
      expect((await core.projects.list())[0]?.name).toBe("Renamed");
      await core.projects.remove(project.id);
      expect(await core.projects.list()).toEqual([]);
    });

    it("rejects unknown projects with not_found", async () => {
      const { core } = target;
      await rejectsWithCode(core.projects.rename("nope", "x"), "not_found");
      await rejectsWithCode(core.projects.remove("nope"), "not_found");
      await rejectsWithCode(core.conversations.list("nope"), "not_found");
      await rejectsWithCode(core.conversations.create("nope"), "not_found");
    });

    it("announces project changes", async () => {
      const { core, paths } = target;
      const { changes, stop } = collectChanges(core);
      const project = await core.projects.add({ path: await paths.directory("alpha") });
      await core.projects.rename(project.id, "Renamed");
      await core.projects.remove(project.id);
      stop();
      expect(changes.filter((change) => change.resource === "projects")).toHaveLength(3);
    });

    it("keeps projects after a restart", async () => {
      if (!target.reopen) return;
      const project = await target.core.projects.add({ path: await target.paths.directory("alpha") });
      const reopened = await target.reopen();
      expect(await reopened.projects.list()).toEqual([project]);
    });
  });
}
