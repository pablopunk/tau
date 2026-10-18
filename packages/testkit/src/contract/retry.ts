import { isRetryable } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import {
  entryKinds,
  nextRequestId,
  rejectsWithCode,
  startConversation,
  trackView,
  waitFor,
  waitForIdle,
  waitForSummary,
} from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function retryCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("retry", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[retry] continues after a failed answer, once per requestId", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "fail" });
      await waitForSummary(core, conversation, (summary) => summary.status === "error", "error");
      const tracker = await trackView(core, conversation.id);
      expect(isRetryable(tracker.view() as never)).toBe(true);
      const requestId = nextRequestId();
      await core.conversations.retry(conversation.id, { requestId });
      await core.conversations.retry(conversation.id, { requestId });
      await waitFor(() => entryKinds(tracker.view()).includes("app.retry"), "the retry entry");
      await waitForSummary(core, conversation, (summary) => summary.status === "idle", "the answer");
      await waitForIdle(tracker);
      expect(entryKinds(tracker.view()).filter((kind) => kind === "app.retry")).toHaveLength(1);
      expect(isRetryable(tracker.view() as never)).toBe(false);
      await tracker.stop();
    });

    test("[retry] refuses to retry a finished answer", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      const tracker = await trackView(core, conversation.id);
      await waitForIdle(tracker);
      await tracker.stop();
      await rejectsWithCode(
        core.conversations.retry(conversation.id, { requestId: nextRequestId() }),
        "invalid_request",
      );
    });
  });
}
