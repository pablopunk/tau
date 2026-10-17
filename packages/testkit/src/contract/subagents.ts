import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { startConversation, waitFor } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function subagentCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("subagents", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    async function threadWithChild() {
      const started = await startConversation(target, { text: "task look around" });
      const { core } = target;
      await waitFor(
        async () =>
          (await core.conversations.list(started.project.id)).some((item) => item.parentId !== null),
        "the subagent thread",
      );
      const all = await core.conversations.list(started.project.id);
      const child = all.find((item) => item.parentId !== null);
      return { ...started, child: child as NonNullable<typeof child> };
    }

    test("[subagents] lists a subagent thread with its parent and title", async () => {
      const { conversation, child } = await threadWithChild();
      expect(child.parentId).toBe(conversation.id);
      expect(child.title).toBe("look around");
      expect(conversation.parentId).toBeNull();
    });

    test("[subagents] archives and deletes children with their parent", async () => {
      const { core } = target;
      const { project, conversation, child } = await threadWithChild();
      await core.conversations.archive(conversation.id, true);
      const archived = await core.conversations.list(project.id);
      expect(archived.find((item) => item.id === child.id)?.archivedAt).toEqual(expect.any(Number));
      await core.conversations.remove(conversation.id);
      expect(await core.conversations.list(project.id)).toEqual([]);
    });
  });
}
