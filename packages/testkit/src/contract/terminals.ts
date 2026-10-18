import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { collectChanges, rejectsWithCode, startConversation, waitFor } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const decode = (chunks: Uint8Array[]) => chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");

export function terminalCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("terminals", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    async function threadWithTerminal() {
      const { core } = target;
      const started = await startConversation(target, { text: "hello" });
      const info = await core.terminals.open(started.conversation.id, { cols: 80, rows: 24 });
      return { ...started, info };
    }

    test("[terminals] opens, lists and reports availability", async () => {
      const { core } = target;
      expect(await core.terminals.available()).toBe(true);
      const { conversation, info } = await threadWithTerminal();
      expect(info).toMatchObject({
        conversationId: conversation.id,
        status: "running",
        exitCode: null,
        createdAt: expect.any(Number),
      });
      expect(await core.terminals.list(conversation.id)).toEqual([info]);
      expect(await core.terminals.list("other").catch((error) => error.code)).toBe("not_found");
      await rejectsWithCode(core.terminals.open("other", { cols: 80, rows: 24 }), "not_found");
    });

    test("[terminals] replays the kept output, then streams live", async () => {
      const { core } = target;
      const { info } = await threadWithTerminal();
      const first: Uint8Array[] = [];
      const one = await core.terminals.attach(info.id, {
        onData: (d) => first.push(d),
        onExit: () => undefined,
      });
      one.write(new TextEncoder().encode("echo hi\r"));
      await waitFor(() => decode(first).includes("hi"), "the echo");
      const second: Uint8Array[] = [];
      const two = await core.terminals.attach(info.id, {
        onData: (d) => second.push(d),
        onExit: () => undefined,
      });
      await waitFor(() => decode(second).includes("hi"), "the replay");
      const replayLength = decode(second).length;
      one.write(new TextEncoder().encode("echo again\r"));
      await waitFor(() => decode(second).includes("again"), "live output after the replay");
      expect(decode(second).indexOf("hi")).toBeLessThan(decode(second).indexOf("again"));
      expect(replayLength).toBeLessThan(decode(second).length);
      one.detach();
      two.detach();
    });

    test("[terminals] a clean exit drops the record; a failed one keeps it until closed", async () => {
      const { core } = target;
      const { conversation, info } = await threadWithTerminal();
      const exits: Array<number | null> = [];
      const attachment = await core.terminals.attach(info.id, {
        onData: () => undefined,
        onExit: (c) => exits.push(c),
      });
      const { changes, stop } = collectChanges(core);
      attachment.write(new TextEncoder().encode("exit\r"));
      await waitFor(() => exits.length === 1, "the exit");
      stop();
      expect(changes).toContainEqual({ resource: "terminals", conversationId: conversation.id });
      expect(await core.terminals.list(conversation.id)).toEqual([]);
      await core.terminals.close(info.id);
      await core.terminals.close(info.id);
      await rejectsWithCode(core.terminals.close("nope"), "not_found");
      await rejectsWithCode(
        core.terminals.attach("nope", { onData: () => undefined, onExit: () => undefined }),
        "not_found",
      );
    });

    test("[terminals] a non-zero exit keeps the ended record until closed", async () => {
      const { core } = target;
      const { conversation, info } = await threadWithTerminal();
      const exits: Array<number | null> = [];
      const attachment = await core.terminals.attach(info.id, {
        onData: () => undefined,
        onExit: (c) => exits.push(c),
      });
      attachment.write(new TextEncoder().encode("exit 3\r"));
      await waitFor(() => exits.length === 1, "the exit");
      expect((await core.terminals.list(conversation.id))[0]).toMatchObject({
        status: "exited",
        exitCode: 3,
      });
      await core.terminals.close(info.id);
      expect(await core.terminals.list(conversation.id)).toEqual([]);
    });

    test("[terminals] closing ends the shell", async () => {
      const { core } = target;
      const { conversation, info } = await threadWithTerminal();
      await core.terminals.close(info.id);
      expect(await core.terminals.list(conversation.id)).toEqual([]);
    });

    test("[terminals] ends a thread's terminals when it is archived or deleted", async () => {
      const { core } = target;
      const { conversation, info } = await threadWithTerminal();
      await core.conversations.archive(conversation.id, true);
      expect((await core.terminals.list(conversation.id))[0]?.status).toBe("exited");
      await core.conversations.remove(conversation.id);
      await rejectsWithCode(core.terminals.list(conversation.id), "not_found");
      expect(info.id).toBeTruthy();
    });

    test("[terminals] allows 8 per thread", async () => {
      const { core } = target;
      const { conversation } = await threadWithTerminal();
      for (let count = 1; count < 8; count++)
        await core.terminals.open(conversation.id, { cols: 80, rows: 24 });
      await rejectsWithCode(core.terminals.open(conversation.id, { cols: 80, rows: 24 }), "invalid_request");
    });
  });
}
