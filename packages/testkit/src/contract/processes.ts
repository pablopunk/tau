import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode, startConversation, waitFor } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function processCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("processes", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    async function threadWithProcess() {
      const { core } = target;
      const started = await startConversation(target, { text: "bg sleep 60" });
      await waitFor(
        async () => (await core.processes.list(started.conversation.id)).length === 1,
        "the process",
      );
      const [info] = await core.processes.list(started.conversation.id);
      return { ...started, info: info as NonNullable<typeof info> };
    }

    test("[processes] lists a background process the agent started", async () => {
      const { conversation, info } = await threadWithProcess();
      expect(info).toMatchObject({
        conversationId: conversation.id,
        command: "sleep 60",
        state: "running",
        exitCode: null,
        startedAt: expect.any(Number),
      });
      expect(await target.core.processes.list("other")).toEqual([]);
    });

    test("[processes] returns the log tail", async () => {
      const { info } = await threadWithProcess();
      expect(typeof (await target.core.processes.logs(info.id, 50))).toBe("string");
      await rejectsWithCode(target.core.processes.logs("nope", 10), "not_found");
    });

    test("[processes] stops a process idempotently and announces the change", async () => {
      const { core } = target;
      const { conversation, info } = await threadWithProcess();
      const { changes, stop } = collectChanges(core);
      await core.processes.stop(info.id);
      await core.processes.stop(info.id);
      stop();
      expect((await core.processes.list(conversation.id))[0]?.state).toBe("killed");
      expect(changes).toContainEqual({ resource: "processes", conversationId: conversation.id });
      await rejectsWithCode(core.processes.stop("nope"), "not_found");
    });

    test("[processes] stops a thread's processes when the thread is deleted", async () => {
      const { core } = target;
      const { conversation, info } = await threadWithProcess();
      await core.conversations.remove(conversation.id);
      const left = (await core.processes.list(conversation.id)).find((item) => item.id === info.id);
      expect(left?.state ?? "killed").toBe("killed");
    });
  });
}
