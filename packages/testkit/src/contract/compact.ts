import { afterEach, beforeEach, describe } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode, startConversation, trackView, waitForIdle } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function compactCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("compact", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[compact] rejects an unknown thread with not_found", async () => {
      await rejectsWithCode(target.core.conversations.compact("999999", {}), "not_found");
    });

    test("[compact] has nothing to compact in a short thread", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "short" });
      const tracker = await trackView(core, conversation.id);
      await waitForIdle(tracker);
      await tracker.stop();
      await rejectsWithCode(core.conversations.compact(conversation.id, {}), "nothing_to_compact");
    });
  });
}
