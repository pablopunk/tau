import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { configure, FAST_MODEL, startConversation, summaryOf, waitFor, waitForSummary } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const TITLE_GRACE_MS = 600;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function titleAndStatusCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("titles and status", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[titles] generates a title with the fast model", async () => {
      const { core } = target;
      await configure(core);
      await core.settings.setFastModel(FAST_MODEL);
      const { conversation } = await startConversation(target, { text: "Refactor the login flow today" });
      await waitForSummary(
        core,
        conversation,
        (summary) => summary.title === "Refactor the login",
        "a title",
      );
    });

    test("[titles] does not replace a title the user chose", async () => {
      const { core } = target;
      await configure(core);
      await core.settings.setFastModel(FAST_MODEL);
      const { conversation } = await startConversation(target, { text: "Refactor the login flow today" });
      await core.conversations.rename(conversation.id, "Mine");
      await sleep(TITLE_GRACE_MS);
      expect((await summaryOf(core, conversation)).title).toBe("Mine");
    });

    test("[status] goes running and back to idle, and records when the run ended", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "bash sleep 1" });
      await waitForSummary(core, conversation, (summary) => summary.status === "running", "running");
      const done = await waitForSummary(
        core,
        conversation,
        (summary) => summary.status === "idle" && summary.lastRunEndedAt !== null,
        "idle after the run",
      );
      expect(done.lastRunEndedAt).toEqual(expect.any(Number));
    });

    test("[status] shows error after a failed run", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "fail" });
      await waitForSummary(core, conversation, (summary) => summary.status === "error", "error");
      await waitFor(
        async () => (await summaryOf(core, conversation)).lastRunEndedAt !== null,
        "its end time",
      );
    });
  });
}
