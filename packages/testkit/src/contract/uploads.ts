import { MAX_UPLOAD_FILE_BYTES } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import {
  addProject,
  configure,
  nextRequestId,
  rejectsWithCode,
  startConversation,
  TEXT_ONLY_MODEL,
  trackView,
  waitForIdle,
} from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const UUID_PATH = /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

export function uploadCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("uploads", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    async function staged(name = "notes.txt", text = "hello") {
      const { core } = target;
      if (!(await core.models.list()).length) await configure(core);
      return core.uploads.stage({ name, mimeType: "text/plain", data: toBase64(Buffer.from(text)) });
    }

    test("[uploads] stages a file and returns a UUID-shaped virtual path", async () => {
      const ref = await staged();
      expect(ref.name).toBe("notes.txt");
      expect(ref.path).toMatch(UUID_PATH);
      expect(ref.size).toBe(5);
      // Deterministic: the next stage gets the next path, never the same one.
      const again = await staged();
      expect(again.path).toMatch(UUID_PATH);
      expect(again.path).not.toBe(ref.path);
    });

    test("[uploads] rejects an oversize file with too_large", async () => {
      const { core } = target;
      if (!(await core.models.list()).length) await configure(core);
      await rejectsWithCode(
        core.uploads.stage({
          name: "big.bin",
          mimeType: "application/octet-stream",
          data: toBase64(Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1)),
        }),
        "too_large",
      );
    });

    test("[uploads] sends staged files as path-only context, even on a text-only model", async () => {
      const { core } = target;
      const ref = await staged();
      const project = await addProject(target);
      const conversation = await core.conversations.start({
        projectId: project.id,
        text: "read this",
        files: [ref],
        model: TEXT_ONLY_MODEL,
        requestId: nextRequestId(),
      });
      const tracker = await trackView(core, conversation.id);
      await waitForIdle(tracker);
      const entries = JSON.stringify(tracker.view()?.entries ?? []);
      expect(entries).toContain(ref.path);
      expect(entries).not.toContain(toBase64(Buffer.from("hello")));
      await tracker.stop();

      const second = await staged("plan.md", "second");
      await core.conversations.send(conversation.id, {
        text: "and this",
        files: [second],
        requestId: nextRequestId(),
      });
      const updated = await trackView(core, conversation.id);
      await waitForIdle(updated);
      expect(JSON.stringify(updated.view()?.entries ?? [])).toContain(second.path);
      await updated.stop();
    });

    test("[uploads] rejects unknown refs with file_expired and an actionable message", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target);
      const missing = { name: "gone.txt", path: "uploads/00000000-0000-4000-8000-000000000000", size: 1 };
      try {
        await core.conversations.send(conversation.id, {
          text: "read this",
          files: [missing],
          requestId: nextRequestId(),
        });
        throw new Error("expected file_expired");
      } catch (error) {
        expect(error).toMatchObject({ code: "file_expired" });
        expect((error as Error).message).toMatch(/stage it again/i);
      }
      await rejectsWithCode(
        core.conversations.start({
          projectId: conversation.projectId,
          text: "read this",
          files: [missing],
          requestId: nextRequestId(),
        }),
        "file_expired",
      );
    });

    test("[uploads] rejects paths outside the uploads root with invalid_request", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target);
      for (const path of ["../secret.txt", "/etc/passwd", "uploads/../../etc/passwd"]) {
        await rejectsWithCode(
          core.conversations.send(conversation.id, {
            text: "read this",
            files: [{ name: "evil.txt", path, size: 1 }],
            requestId: nextRequestId(),
          }),
          "invalid_request",
        );
      }
    });
  });
}
