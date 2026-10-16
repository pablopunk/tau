import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode } from "./helpers";
import { iconPng, pngOfSize } from "./png";
import type { ContractTarget, MakeContractTarget } from "./types";

export function iconCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("icons", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    const addProject = async () => target.core.projects.add({ path: await target.paths.directory("alpha") });

    test("[icons] gives a project an icon url and Home none", async () => {
      const { core } = target;
      const project = await addProject();
      expect(project.iconUrl).toMatch(new RegExp(`^/api/projects/${project.id}/icon\\?v=.+`));
      const [home] = await core.projects.list();
      expect(home?.iconUrl ?? null).toBeNull();
      expect(await core.projects.icon("home")).toBeNull();
    });

    test("[icons] stores a custom icon, changes the url and resets it", async () => {
      const { core } = target;
      const project = await addProject();
      await core.projects.setIcon(project.id, iconPng(1));
      const custom = await core.projects.icon(project.id);
      expect(custom?.contentType).toBe("image/png");
      expect(Array.from(custom?.data ?? [])).toEqual(Array.from(iconPng(1)));
      const changed = (await core.projects.list()).find((item) => item.id === project.id);
      expect(changed?.iconUrl).not.toBe(project.iconUrl);
      await core.projects.setIcon(project.id, null);
      expect((await core.projects.list()).find((item) => item.id === project.id)?.iconUrl).toBe(
        project.iconUrl,
      );
    });

    test("[icons] announces an icon change", async () => {
      const { core } = target;
      const project = await addProject();
      const { changes, stop } = collectChanges(core);
      await core.projects.setIcon(project.id, iconPng());
      stop();
      expect(changes).toContainEqual({ resource: "projects" });
    });

    test("[icons] rejects a wrong size, a non-png, Home and unknown projects", async () => {
      const { core } = target;
      const project = await addProject();
      await rejectsWithCode(core.projects.setIcon(project.id, pngOfSize(64, 64)), "invalid_request");
      await rejectsWithCode(core.projects.setIcon(project.id, new Uint8Array(40)), "invalid_request");
      await rejectsWithCode(core.projects.setIcon("home", iconPng()), "invalid_request");
      await rejectsWithCode(core.projects.setIcon("nope", iconPng()), "not_found");
      await rejectsWithCode(core.projects.icon("nope"), "not_found");
      await rejectsWithCode(core.projects.iconCandidates("nope"), "not_found");
    });

    test("[icons] lists candidates and rejects a name that is not one", async () => {
      const { core } = target;
      const project = await addProject();
      expect(Array.isArray(await core.projects.iconCandidates(project.id))).toBe(true);
      await rejectsWithCode(core.projects.iconCandidate(project.id, "no-such-file.png"), "not_found");
    });
  });
}
