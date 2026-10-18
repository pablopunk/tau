import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode, startConversation } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

/** Owner C (MVP8) extends these; the real core lists the tag as pending until its timers exist. */
export function timerCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("timers", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[timers] a thread starts with no timers, and an unknown thread is not found", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      expect(await core.timers.list(conversation.id)).toEqual([]);
      expect(conversation).toMatchObject({ timers: 0, nextTimerAt: null });
      await rejectsWithCode(core.timers.list("nope"), "not_found");
    });

    test("[timers] a loop with an interval makes a repeat timer, and stopLoop removes it", async () => {
      const { core } = target;
      const { conversation, project } = await startConversation(target, { text: "hello" });
      await core.timers.loop(conversation.id, { every: "5m", prompt: "check the build" });
      const [timer] = await core.timers.list(conversation.id);
      expect(timer).toMatchObject({ kind: "repeat", every: "5m", source: "loop", prompt: "check the build" });
      const summary = (await core.conversations.list(project.id)).find((item) => item.id === conversation.id);
      expect(summary?.timers).toBe(1);
      expect(summary?.nextTimerAt).toEqual(expect.any(String));
      await core.timers.stopLoop(conversation.id);
      expect(await core.timers.list(conversation.id)).toEqual([]);
    });

    test("[timers] delete is idempotent and announces the change", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      await core.timers.loop(conversation.id, { every: "5m", prompt: "tick" });
      const [timer] = await core.timers.list(conversation.id);
      const { changes, stop } = collectChanges(core);
      await core.timers.delete(timer?.id ?? "");
      await core.timers.delete(timer?.id ?? "");
      stop();
      expect(await core.timers.list(conversation.id)).toEqual([]);
      expect(changes).toContainEqual({ resource: "timers", conversationId: conversation.id });
    });

    test("[timers] a loop interval under one minute is rejected", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      await rejectsWithCode(
        core.timers.loop(conversation.id, { every: "30s", prompt: "tick" }),
        "invalid_request",
      );
    });
  });
}
