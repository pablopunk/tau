import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { configure, nextRequestId, rejectsWithCode, waitFor } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const BAD_URLS = [
  "-x",
  "ext::sh -c touch% /tmp/pwned",
  "a::b",
  "https://example.com/../x",
  "https://user:pw@example.com/x.git",
];

export function cloneCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("git projects", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    const statusOf = async (id: string) => (await target.core.projects.list()).find((item) => item.id === id);

    test("[clone] goes from cloning to ready", async () => {
      const { core, paths } = target;
      const cloning = await core.projects.clone({ url: await paths.cloneUrl() });
      expect(cloning).toMatchObject({ kind: "git", status: "cloning", path: expect.any(String) });
      await waitFor(async () => (await statusOf(cloning.id))?.status === "ready", "the clone to finish");
    });

    test("[clone] fails, can be retried, and rejects a retry of a healthy project", async () => {
      const { core, paths } = target;
      const project = await core.projects.clone({ url: paths.failingCloneUrl() });
      await waitFor(async () => (await statusOf(project.id))?.status === "failed", "the clone to fail");
      expect((await statusOf(project.id))?.error).toEqual(expect.any(String));
      await core.projects.retryClone(project.id);
      expect(["cloning", "failed"]).toContain((await statusOf(project.id))?.status);
      const healthy = await core.projects.clone({ url: await paths.cloneUrl() });
      await waitFor(async () => (await statusOf(healthy.id))?.status === "ready", "the clone to finish");
      await rejectsWithCode(core.projects.retryClone(healthy.id), "invalid_request");
    });

    test("[clone] rejects unsafe URLs and duplicates, and a thread cannot start before it is ready", async () => {
      const { core, paths } = target;
      for (const url of BAD_URLS) await rejectsWithCode(core.projects.clone({ url }), "invalid_git_url");
      const project = await core.projects.clone({ url: paths.failingCloneUrl() });
      await rejectsWithCode(core.projects.clone({ url: paths.failingCloneUrl() }), "duplicate_project");
      await configure(core);
      await rejectsWithCode(
        core.conversations.start({ projectId: project.id, text: "hi", requestId: nextRequestId() }),
        "project_not_ready",
      );
      expect(project.status).not.toBe("ready");
    });
  });
}
