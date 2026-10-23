import { HandoffPreviewSchema } from "@tau/protocol";
import { Value } from "typebox/value";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { addProject, configure, nextRequestId, rejectsWithCode, startConversation } from "./helpers";
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

    test("[runtimes] says a Pi thread cannot be handed off while native is off, with the reason and a valid preview", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "first" });

      const preview = await core.conversations.handoffPreview(conversation.id);

      expect(Value.Check(HandoffPreviewSchema, preview)).toBe(true);
      expect(preview).toMatchObject({ canHandoff: false, reason: NATIVE_OFF_MESSAGE });
    });

    test("[runtimes] refuses a handoff with invalid_request while native is off and creates no thread", async () => {
      const { core } = target;
      const { project, conversation } = await startConversation(target, { text: "first" });
      const before = await core.conversations.list(project.id);

      await expect(
        core.conversations.handoff(conversation.id, { requestId: nextRequestId(), instruction: "carry on" }),
      ).rejects.toMatchObject({ code: "invalid_request", message: NATIVE_OFF_MESSAGE });

      expect(await core.conversations.list(project.id)).toEqual(before);
    });

    test("[runtimes] rejects a handoff and its preview for an unknown thread with not_found", async () => {
      const { core } = target;

      await rejectsWithCode(core.conversations.handoffPreview("999999"), "not_found");
      await rejectsWithCode(
        core.conversations.handoff("999999", { requestId: nextRequestId() }),
        "not_found",
      );
    });

    test("[runtimes] rejects a blank handoff requestId with invalid_request before anything else", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "first" });

      await rejectsWithCode(
        core.conversations.handoff(conversation.id, { requestId: " " }),
        "invalid_request",
      );
    });
  });
}
