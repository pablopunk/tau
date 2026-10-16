import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode, userProjects } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function projectCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("projects", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("adds a project named after its folder, and lists it", async () => {
      const { core, paths } = target;
      const path = await paths.directory("alpha");
      const project = await core.projects.add({ path });
      expect(project).toMatchObject({
        name: "alpha",
        createdAt: expect.any(Number),
        kind: "folder",
        status: "ready",
      });
      expect(project.id).toEqual(expect.any(String));
      expect(await userProjects(core)).toEqual([project]);
    });

    test("uses the given name", async () => {
      const { core, paths } = target;
      const project = await core.projects.add({ path: await paths.directory("beta"), name: "Beta" });
      expect(project.name).toBe("Beta");
    });

    test("keeps projects in creation order", async () => {
      const { core, paths } = target;
      const first = await core.projects.add({ path: await paths.directory("one") });
      const second = await core.projects.add({ path: await paths.directory("two") });
      expect((await userProjects(core)).map((project) => project.id)).toEqual([first.id, second.id]);
    });

    test("rejects a duplicate, a missing path and a file", async () => {
      const { core, paths } = target;
      const path = await paths.directory("alpha");
      await core.projects.add({ path });
      await rejectsWithCode(core.projects.add({ path }), "duplicate_project");
      await rejectsWithCode(core.projects.add({ path: paths.missing() }), "path_not_found");
      await rejectsWithCode(core.projects.add({ path: await paths.file("notes.txt") }), "not_a_directory");
    });

    test("renames and removes a project", async () => {
      const { core, paths } = target;
      const project = await core.projects.add({ path: await paths.directory("alpha") });
      await core.projects.rename(project.id, "Renamed");
      expect((await userProjects(core))[0]?.name).toBe("Renamed");
      await core.projects.remove(project.id);
      expect(await userProjects(core)).toEqual([]);
    });

    test("rejects unknown projects with not_found", async () => {
      const { core } = target;
      await rejectsWithCode(core.projects.rename("nope", "x"), "not_found");
      await rejectsWithCode(core.projects.remove("nope"), "not_found");
      await rejectsWithCode(core.conversations.list("nope"), "not_found");
      await rejectsWithCode(
        core.conversations.start({ projectId: "nope", text: "hi", requestId: "r1" }),
        "not_found",
      );
    });

    test("announces project changes", async () => {
      const { core, paths } = target;
      const { changes, stop } = collectChanges(core);
      const project = await core.projects.add({ path: await paths.directory("alpha") });
      await core.projects.rename(project.id, "Renamed");
      await core.projects.remove(project.id);
      stop();
      expect(changes.filter((change) => change.resource === "projects")).toHaveLength(3);
    });

    test("keeps projects after a restart", async () => {
      if (!target.reopen) return;
      const project = await target.core.projects.add({ path: await target.paths.directory("alpha") });
      const reopened = await target.reopen();
      expect(await userProjects(reopened)).toEqual([project]);
    });

    test("[home] lists Home first and keeps it fixed", async () => {
      const { core } = target;
      await core.projects.add({ path: await target.paths.directory("alpha") });
      const [home] = await core.projects.list();
      expect(home).toMatchObject({ id: "home", name: "Home", kind: "home", status: "ready" });
      await rejectsWithCode(core.projects.rename(home?.id ?? "", "Elsewhere"), "invalid_request");
      await rejectsWithCode(core.projects.remove(home?.id ?? ""), "invalid_request");
      await rejectsWithCode(core.projects.add({ path: home?.path ?? "" }), "duplicate_project");
    });
  });
}
