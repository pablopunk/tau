import { GOAL_CONDITION_MAX_LENGTH } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode, startConversation } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

/** Owner D (MVP8) extends these; the real core lists the tag as pending until its goals exist. */
export function goalCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("goals", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[goals] a thread starts without a goal, and an unknown thread is not found", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      expect(await core.goals.get(conversation.id)).toBeNull();
      expect(conversation.goal).toBeNull();
      await rejectsWithCode(core.goals.get("nope"), "not_found");
    });

    test("[goals] set stores an active goal, shows it in the summary, and clear removes it", async () => {
      const { core } = target;
      const { conversation, project } = await startConversation(target, { text: "hello" });
      await core.goals.set(conversation.id, "all tests pass");
      expect(await core.goals.get(conversation.id)).toMatchObject({
        condition: "all tests pass",
        state: "active",
        turnsEvaluated: 0,
      });
      const summary = (await core.conversations.list(project.id)).find((item) => item.id === conversation.id);
      expect(summary?.goal).toEqual({ state: "active", condition: "all tests pass" });
      await core.goals.clear(conversation.id);
      await core.goals.clear(conversation.id);
      expect(await core.goals.get(conversation.id)).toBeNull();
    });

    test("[goals] set rejects an empty or too long condition", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      await rejectsWithCode(core.goals.set(conversation.id, "  "), "invalid_request");
      await rejectsWithCode(
        core.goals.set(conversation.id, "x".repeat(GOAL_CONDITION_MAX_LENGTH + 1)),
        "invalid_request",
      );
    });
  });
}
