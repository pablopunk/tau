import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { addProject, configure, nextRequestId } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const NATIVE_OFF_MESSAGE = "native Claude is not enabled on this node";

export function runtimeCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("runtimes (native off)", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[runtimes] lists pi enabled, then claude-code disabled with a reason and no capability", async () => {
      const { executors } = await target.core.runtimes.list();

      expect(executors.map((entry) => [entry.executor, entry.enabled])).toEqual([
        ["pi", true],
        ["claude-code", false],
      ]);
      const [, claudeCode] = executors;
      expect(claudeCode?.reason).toBe(NATIVE_OFF_MESSAGE);
      for (const state of Object.values(claudeCode?.capabilities ?? {})) {
        expect(state).toEqual({ supported: false, reason: "executor-disabled" });
      }
    });

    test("[runtimes] refuses a claude-code start with invalid_request and starts no Pi thread instead", async () => {
      const { core } = target;
      await configure(core);
      const project = await addProject(target);

      await expect(
        core.conversations.start({
          projectId: project.id,
          text: "hello",
          requestId: nextRequestId(),
          executor: "claude-code",
        }),
      ).rejects.toMatchObject({ code: "invalid_request", message: NATIVE_OFF_MESSAGE });

      expect(await core.conversations.list(project.id)).toEqual([]);
    });

    test("[runtimes] still starts a Pi thread for an omitted or explicit pi executor", async () => {
      const { core } = target;
      await configure(core);
      const project = await addProject(target);

      const omitted = await core.conversations.start({
        projectId: project.id,
        text: "one",
        requestId: nextRequestId(),
      });
      const explicit = await core.conversations.start({
        projectId: project.id,
        text: "two",
        requestId: nextRequestId(),
        executor: "pi",
      });

      expect(omitted.executor).toBeUndefined();
      expect(explicit.executor).toBeUndefined();
      expect(await core.conversations.list(project.id)).toHaveLength(2);
    });
  });
}
