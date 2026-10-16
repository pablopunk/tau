import type { ConversationView } from "@pi-everywhere/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode, SECOND_MODEL, startConversation, trackView, waitFor, waitForIdle } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const agentDoc = (view: ConversationView | null) =>
  view?.docs["pi.agent"] as { model?: { modelId: string }; thinkingLevel?: string } | undefined;

export function configureCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("configure", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[configure] changes the model and clamps the level, then the level alone", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      const tracker = await trackView(core, conversation.id);
      await waitForIdle(tracker);
      await core.conversations.configure(conversation.id, { thinkingLevel: "high" });
      await waitFor(() => agentDoc(tracker.view())?.thinkingLevel === "high", "the new level");
      await core.conversations.configure(conversation.id, { model: SECOND_MODEL });
      await waitFor(() => agentDoc(tracker.view())?.model?.modelId === "faux-2", "the new model");
      expect(agentDoc(tracker.view())?.thinkingLevel).toBe("off");
      await tracker.stop();
    });

    test("[configure] rejects an unlisted model, an empty input and an unknown thread", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      await rejectsWithCode(
        core.conversations.configure(conversation.id, { model: { provider: "faux", modelId: "nope" } }),
        "invalid_request",
      );
      await rejectsWithCode(core.conversations.configure(conversation.id, {}), "invalid_request");
      await rejectsWithCode(core.conversations.configure("999999", { thinkingLevel: "low" }), "not_found");
    });

    test("[configure] a deleted thread is not found", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      await core.conversations.remove(conversation.id);
      await rejectsWithCode(
        core.conversations.configure(conversation.id, { thinkingLevel: "low" }),
        "not_found",
      );
    });
  });
}
