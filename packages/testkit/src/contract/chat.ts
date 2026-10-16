import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  entryKinds,
  isRunning,
  nextRequestId,
  startConversation,
  trackView,
  waitFor,
  waitForIdle,
} from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function chatCases(make: MakeContractTarget): void {
  describe("chat", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    it("starts a watch with a base frame holding the empty view", async () => {
      const { conversation } = await startConversation(target);
      const tracker = await trackView(target.core, conversation.id);
      expect(tracker.batches[0]?.[0]?.[0]).toBe("r");
      expect(tracker.view()?.entries).toEqual([]);
      await tracker.stop();
    });

    it("answers a message and titles the conversation after it", async () => {
      const { core } = target;
      const { project, conversation } = await startConversation(target);
      const tracker = await trackView(core, conversation.id);
      await core.conversations.send(conversation.id, {
        text: "What is a monad?",
        requestId: nextRequestId(),
      });
      await waitForIdle(tracker);
      expect(entryKinds(tracker.view())).toContain("pi.user");
      const [summary] = await core.conversations.list(project.id);
      expect(summary?.title).toBe("What is a monad?");
      expect(summary?.updatedAt).toBeGreaterThanOrEqual(conversation.updatedAt);
      await tracker.stop();
    });

    it("ignores a repeated requestId", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target);
      const tracker = await trackView(core, conversation.id);
      const requestId = nextRequestId();
      await core.conversations.send(conversation.id, { text: "hello", requestId });
      await core.conversations.send(conversation.id, { text: "hello", requestId });
      await waitForIdle(tracker);
      expect(entryKinds(tracker.view()).filter((kind) => kind === "pi.user")).toHaveLength(1);
      await tracker.stop();
    });

    it("runs the write tool in the project folder", async () => {
      const { core } = target;
      const { project, conversation } = await startConversation(target);
      const tracker = await trackView(core, conversation.id);
      await core.conversations.send(conversation.id, {
        text: "write hello.txt hi",
        requestId: nextRequestId(),
      });
      await waitForIdle(tracker);
      expect(entryKinds(tracker.view())).toContain("pi.tool-result");
      expect(await target.readProjectFile?.(project.path, "hello.txt")).toSatisfy(
        (content: string | undefined) => content === undefined || content === "hi",
      );
      await tracker.stop();
    });

    it("steers a message sent while busy", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target);
      const tracker = await trackView(core, conversation.id);
      await core.conversations.send(conversation.id, { text: "bash sleep 1", requestId: nextRequestId() });
      await waitFor(() => isRunning(tracker.view()), "the run to start");
      await core.conversations.send(conversation.id, {
        text: "write steered.txt steered",
        requestId: nextRequestId(),
      });
      await waitFor(
        () =>
          !isRunning(tracker.view()) &&
          entryKinds(tracker.view()).filter((kind) => kind === "pi.user").length === 2,
        "both messages to be answered",
      );
      await tracker.stop();
    });

    it("stops the run on abort", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target);
      const tracker = await trackView(core, conversation.id);
      await core.conversations.send(conversation.id, { text: "bash sleep 30", requestId: nextRequestId() });
      await waitFor(() => isRunning(tracker.view()), "the run to start");
      await core.conversations.abort(conversation.id);
      await waitFor(() => !isRunning(tracker.view()), "the run to stop");
      await tracker.stop();
    });

    it("stops calling the listener after stop()", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target);
      let calls = 0;
      const watcher = await core.conversations.watch(conversation.id, async () => {
        calls++;
      });
      await waitFor(() => calls > 0, "the first frame");
      await watcher.stop();
      const before = calls;
      await core.conversations.send(conversation.id, { text: "hello", requestId: nextRequestId() });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(calls).toBe(before);
    });

    it("removing a project stops its busy conversations", async () => {
      const { core } = target;
      const { project, conversation } = await startConversation(target);
      await core.conversations.send(conversation.id, { text: "bash sleep 30", requestId: nextRequestId() });
      await core.projects.remove(project.id);
      expect(await core.projects.list()).toEqual([]);
    });

    it("shows earlier messages after a restart", async () => {
      if (!target.reopen) return;
      const { conversation } = await startConversation(target);
      const tracker = await trackView(target.core, conversation.id);
      await target.core.conversations.send(conversation.id, { text: "hello", requestId: nextRequestId() });
      await waitForIdle(tracker);
      await tracker.stop();
      const reopened = await target.reopen();
      const again = await trackView(reopened, conversation.id);
      expect(entryKinds(again.view())).toContain("pi.user");
      await again.stop();
    });
  });
}
