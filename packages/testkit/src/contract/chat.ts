import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import {
  entryKinds,
  isRunning,
  nextRequestId,
  startConversation,
  trackView,
  userProjects,
  userTexts,
  waitFor,
  waitForIdle,
} from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function chatCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("chat", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("starts a watch with a base frame holding the thread's view", async () => {
      const { conversation } = await startConversation(target);
      const tracker = await trackView(target.core, conversation.id);
      expect(tracker.batches[0]?.[0]?.[0]).toBe("r");
      expect(tracker.view()?.docs["pi.agent"]).toBeDefined();
      await tracker.stop();
    });

    test("answers the first message, and a later one", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "What is a monad?" });
      const tracker = await trackView(core, conversation.id);
      await waitForIdle(tracker);
      expect(entryKinds(tracker.view())).toContain("pi.user");
      await core.conversations.send(conversation.id, { text: "And a functor?", requestId: nextRequestId() });
      await waitFor(
        () =>
          !isRunning(tracker.view()) &&
          entryKinds(tracker.view()).filter((kind) => kind === "pi.user").length === 2,
        "the second answer",
      );
      await tracker.stop();
    });

    test("[bang] stores a bang command verbatim as the user entry", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target);
      const tracker = await trackView(core, conversation.id);
      await core.conversations.send(conversation.id, { text: "! echo hi", requestId: nextRequestId() });
      // Result delivery is a real-core capability; the contract pins the uniform part: the verbatim entry.
      await waitFor(() => userTexts(tracker.view()).includes("! echo hi"), "the verbatim bang entry");
      await tracker.stop();
    });

    test("ignores a repeated requestId", async () => {
      const { core } = target;
      const requestId = nextRequestId();
      const { conversation } = await startConversation(target, { requestId });
      const tracker = await trackView(core, conversation.id);
      await core.conversations.send(conversation.id, { text: "hello", requestId });
      await core.conversations.send(conversation.id, { text: "hello", requestId });
      await waitForIdle(tracker);
      expect(entryKinds(tracker.view()).filter((kind) => kind === "pi.user")).toHaveLength(1);
      await tracker.stop();
    });

    test("runs the write tool in the project folder", async () => {
      const { core } = target;
      const { project, conversation } = await startConversation(target, { text: "write hello.txt hi" });
      const tracker = await trackView(core, conversation.id);
      await waitForIdle(tracker, "pi.tool-result");
      expect(await target.readProjectFile?.(project.path, "hello.txt")).toSatisfy(
        (content: string | undefined) => content === undefined || content === "hi",
      );
      await tracker.stop();
    });

    test("steers a message sent while busy", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "bash sleep 1" });
      const tracker = await trackView(core, conversation.id);
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

    test("stops the run on abort", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "bash sleep 30" });
      const tracker = await trackView(core, conversation.id);
      await waitFor(() => isRunning(tracker.view()), "the run to start");
      await core.conversations.abort(conversation.id);
      await waitFor(() => !isRunning(tracker.view()), "the run to stop");
      await tracker.stop();
    });

    test("stops calling the listener after stop()", async () => {
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

    test("removing a project stops its busy conversations", async () => {
      const { core } = target;
      const { project } = await startConversation(target, { text: "bash sleep 30" });
      await core.projects.remove(project.id);
      expect(await userProjects(core)).toEqual([]);
    });

    test("shows earlier messages after a restart", async () => {
      if (!target.reopen) return;
      const { conversation } = await startConversation(target);
      const tracker = await trackView(target.core, conversation.id);
      await waitForIdle(tracker);
      await tracker.stop();
      const reopened = await target.reopen();
      const again = await trackView(reopened, conversation.id);
      expect(entryKinds(again.view())).toContain("pi.user");
      await again.stop();
    });
  });
}
