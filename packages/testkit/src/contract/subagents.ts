import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { rejectsWithCode, startConversation, trackView, waitFor } from "./helpers";
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

    test("[subagents-task] lists a subagent thread with its parent and title", async () => {
      const { conversation, child } = await threadWithChild();
      expect(child.parentId).toBe(conversation.id);
      expect(child.title).toBe("look around");
      expect(conversation.parentId).toBeNull();
    });

    test("[subagents-task] summaries carry the legacy agent defaults", async () => {
      const { conversation, child } = await threadWithChild();
      for (const thread of [conversation, child]) {
        expect(thread).toMatchObject({
          agentType: null,
          agentModel: null,
          agentStatus: null,
          background: false,
        });
      }
    });

    test("[subagents] stopAgent rejects unknown threads and threads that are not children", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      await rejectsWithCode(core.conversations.stopAgent("nope"), "not_found");
      await rejectsWithCode(core.conversations.stopAgent(conversation.id), "invalid_request");
    });

    test("[subagents-v2] a background child reports back with a notification entry", async () => {
      const started = await startConversation(target, { text: "agent look around" });
      const tracker = await trackView(target.core, started.conversation.id);
      await waitFor(
        () => tracker.view()?.entries.some((entry) => entry.kind === "app.subagent_notification") ?? false,
        "the notification entry",
      );
      const children = (await target.core.conversations.list(started.project.id)).filter(
        (item) => item.parentId !== null,
      );
      expect(children).toMatchObject([
        { background: true, agentType: "general-purpose", agentStatus: "done" },
      ]);
      await tracker.stop();
    });

    test("[subagents-v2] stopAgent stops a running child and reports stopped", async () => {
      const { core } = target;
      const started = await startConversation(target, { text: "agent bash sleep 30" });
      const child = await waitFor(
        async () =>
          (await core.conversations.list(started.project.id)).some((item) => item.parentId !== null),
        "the child",
      ).then(async () =>
        (await core.conversations.list(started.project.id)).find((item) => item.parentId !== null),
      );
      await core.conversations.stopAgent(child?.id ?? "");
      await waitFor(
        async () =>
          (await core.conversations.list(started.project.id)).find((item) => item.id === child?.id)
            ?.agentStatus === "stopped",
        "the stopped status",
      );
    });

    test("[subagents-task] archives and deletes children with their parent", async () => {
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
