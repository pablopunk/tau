import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addProject, collectChanges, configure, rejectsWithCode } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function conversationCases(make: MakeContractTarget): void {
  describe("conversations", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    it("needs a provider and a default model to create one", async () => {
      const { core } = target;
      const project = await addProject(target);
      await rejectsWithCode(core.conversations.create(project.id), "no_provider");
      await core.provider.setApiKey("sk-contract-test");
      await rejectsWithCode(core.conversations.create(project.id), "no_default_model");
    });

    it("creates an untitled conversation and lists it under its project", async () => {
      const { core } = target;
      await configure(core);
      const project = await addProject(target);
      const conversation = await core.conversations.create(project.id);
      expect(conversation).toMatchObject({ projectId: project.id, title: "", createdAt: expect.any(Number) });
      expect(conversation.updatedAt).toBeGreaterThanOrEqual(conversation.createdAt);
      expect(await core.conversations.list(project.id)).toEqual([conversation]);
    });

    it("keeps conversations of different projects apart", async () => {
      const { core } = target;
      await configure(core);
      const first = await addProject(target, "first");
      const second = await addProject(target, "second");
      await core.conversations.create(first.id);
      expect(await core.conversations.list(second.id)).toEqual([]);
    });

    it("renames a conversation and announces index changes", async () => {
      const { core } = target;
      await configure(core);
      const project = await addProject(target);
      const { changes, stop } = collectChanges(core);
      const conversation = await core.conversations.create(project.id);
      await core.conversations.rename(conversation.id, "My title");
      stop();
      expect((await core.conversations.list(project.id))[0]?.title).toBe("My title");
      expect(changes).toContainEqual({ resource: "conversations", projectId: project.id });
    });

    it("rejects unknown conversations with not_found", async () => {
      const { core } = target;
      await rejectsWithCode(core.conversations.rename("nope", "x"), "not_found");
      await rejectsWithCode(core.conversations.send("nope", { text: "hi", requestId: "r1" }), "not_found");
      await rejectsWithCode(core.conversations.abort("nope"), "not_found");
      await rejectsWithCode(
        core.conversations.watch("nope", async () => {}),
        "not_found",
      );
    });

    it("keeps conversations after a restart", async () => {
      if (!target.reopen) return;
      await configure(target.core);
      const project = await addProject(target);
      const conversation = await target.core.conversations.create(project.id);
      const reopened = await target.reopen();
      expect(await reopened.conversations.list(project.id)).toEqual([conversation]);
    });
  });
}
