import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import {
  addProject,
  collectChanges,
  configure,
  nextRequestId,
  rejectsWithCode,
  startConversation,
  waitForSummary,
} from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function conversationCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("conversations", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("needs a provider and a default model to start one", async () => {
      const { core } = target;
      const project = await addProject(target);
      const input = { projectId: project.id, text: "hello", requestId: nextRequestId() };
      await rejectsWithCode(core.conversations.start(input), "no_provider");
      await core.providers.setApiKey("openrouter", "sk-contract-test");
      await rejectsWithCode(core.conversations.start(input), "no_default_model");
    });

    test("starts a thread titled after its first message and lists it under its project", async () => {
      const { core } = target;
      const { project, conversation } = await startConversation(target, { text: "Hello there" });
      expect(conversation).toMatchObject({
        projectId: project.id,
        title: "Hello there",
        archivedAt: null,
        createdAt: expect.any(Number),
      });
      expect((await core.conversations.list(project.id)).map((item) => item.id)).toEqual([conversation.id]);
    });

    test("keeps conversations of different projects apart", async () => {
      const { core } = target;
      await configure(core);
      const first = await addProject(target, "first");
      const second = await addProject(target, "second");
      await startConversation(target, { projectId: first.id });
      expect(await core.conversations.list(second.id)).toEqual([]);
    });

    test("renames a conversation and announces index changes", async () => {
      const { core } = target;
      await configure(core);
      const project = await addProject(target);
      const { changes, stop } = collectChanges(core);
      const { conversation } = await startConversation(target, { projectId: project.id });
      await core.conversations.rename(conversation.id, "My title");
      stop();
      expect((await core.conversations.list(project.id))[0]?.title).toBe("My title");
      expect(changes).toContainEqual({ resource: "conversations", projectId: project.id });
    });

    test("rejects unknown conversations with not_found", async () => {
      const { core } = target;
      await rejectsWithCode(core.conversations.rename("nope", "x"), "not_found");
      await rejectsWithCode(core.conversations.send("nope", { text: "hi", requestId: "r1" }), "not_found");
      await rejectsWithCode(core.conversations.abort("nope"), "not_found");
      await rejectsWithCode(
        core.conversations.watch("nope", async () => {}),
        "not_found",
      );
    });

    test("keeps conversations after a restart", async () => {
      if (!target.reopen) return;
      const { project, conversation } = await startConversation(target);
      const reopened = await target.reopen();
      expect((await reopened.conversations.list(project.id)).map((item) => item.id)).toEqual([
        conversation.id,
      ]);
    });

    test("[listAll] lists every thread across Home and projects, most recent first", async () => {
      const { core } = target;
      const { conversation: inProject } = await startConversation(target, { text: "in project" });
      const { conversation: inHome } = await startConversation(target, {
        text: "in home",
        projectId: "home",
      });
      await waitForSummary(core, inHome, (summary) => summary.status === "idle", "the Home thread to settle");
      const all = await core.conversations.listAll();
      expect(all.map((item) => item.id)).toEqual(expect.arrayContaining([inProject.id, inHome.id]));
      const updated = all.map((item) => item.updatedAt);
      expect(updated).toEqual([...updated].sort((a, b) => b - a));
    });
  });
}
