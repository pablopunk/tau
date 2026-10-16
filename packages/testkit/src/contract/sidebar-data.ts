import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { startConversation, waitForSummary } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function sidebarDataCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("sidebar data", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[sidebar-data] uses the thread id as the avatar index", async () => {
      const { conversation } = await startConversation(target);
      expect(conversation.avatarIndex).toBe(Number(conversation.id));
    });

    test("[sidebar-data] last activity is the end of the last run, else the last update", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      const done = await waitForSummary(
        core,
        conversation,
        (summary) => summary.status === "idle" && summary.lastRunEndedAt !== null,
        "the end of the run",
      );
      expect(done.lastActivityAt).toBe(done.lastRunEndedAt);
    });
  });
}
