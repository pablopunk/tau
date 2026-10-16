import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function githubCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("github", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    const fixture = () => {
      if (!target.github) throw new Error("This target has no GitHub fixture");
      return target.github;
    };

    test("[github] reports a connected account", async () => {
      fixture();
      expect(await target.core.github.status()).toMatchObject({
        state: "connected",
        login: expect.any(String),
      });
    });

    test("[github] lists repos newest first with their local copy and project", async () => {
      const { repoWithLocalCopy, repoWithoutLocalCopy } = fixture();
      const repos = await target.core.github.repos();
      const pushed = repos.map((repo) => repo.pushedAt);
      expect(pushed).toEqual([...pushed].sort((a, b) => b - a));
      const local = repos.find((repo) => repo.nameWithOwner === repoWithLocalCopy);
      const remote = repos.find((repo) => repo.nameWithOwner === repoWithoutLocalCopy);
      expect(local).toMatchObject({ localPath: expect.any(String), projectId: null });
      expect(remote).toMatchObject({ localPath: null, projectId: null });
      expect((await target.core.github.refreshRepos()).map((repo) => repo.nameWithOwner)).toEqual(
        repos.map((repo) => repo.nameWithOwner),
      );
    });

    test("[github] uses a local copy as a folder project, once", async () => {
      const { core } = target;
      const { repoWithLocalCopy } = fixture();
      const { changes, stop } = collectChanges(core);
      const project = await core.github.use({ nameWithOwner: repoWithLocalCopy, mode: "local" });
      expect(project).toMatchObject({ kind: "folder", status: "ready", gitUrl: expect.any(String) });
      expect((await core.github.use({ nameWithOwner: repoWithLocalCopy, mode: "local" })).id).toBe(
        project.id,
      );
      stop();
      expect(changes.some((change) => change.resource === "projects")).toBe(true);
      const repo = (await core.github.repos()).find((item) => item.nameWithOwner === repoWithLocalCopy);
      expect(repo?.projectId).toBe(project.id);
      expect((await core.projects.list()).filter((item) => item.gitUrl)).toHaveLength(1);
    });

    test("[github] clones a repo without a local copy", async () => {
      const { core } = target;
      const { repoWithoutLocalCopy } = fixture();
      const project = await core.github.use({ nameWithOwner: repoWithoutLocalCopy, mode: "clone" });
      expect(project.kind).toBe("git");
      expect((await core.github.use({ nameWithOwner: repoWithoutLocalCopy, mode: "clone" })).id).toBe(
        project.id,
      );
    });

    test("[github] uses an existing folder", async () => {
      const { core, paths } = target;
      const { repoWithoutLocalCopy } = fixture();
      const path = await paths.directory("existing");
      const project = await core.github.use({ nameWithOwner: repoWithoutLocalCopy, mode: "folder", path });
      expect(project).toMatchObject({ kind: "folder", path });
    });

    test("[github] rejects an unknown repo and a missing local copy", async () => {
      const { core } = target;
      const { repoWithoutLocalCopy } = fixture();
      await rejectsWithCode(core.github.use({ nameWithOwner: "nobody/nothing", mode: "clone" }), "not_found");
      await rejectsWithCode(
        core.github.use({ nameWithOwner: repoWithoutLocalCopy, mode: "local" }),
        "needs_folder",
      );
    });
  });
}
