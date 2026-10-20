import { TODO_CONTENT_MAX_LENGTH, TODOS_MAX_ITEMS, TODOS_UPDATED_KIND } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import { nextRequestId, rejectsWithCode, startConversation, trackView, waitFor } from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

export function todoCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("todos", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[todos] updateTodos stores the edit where the panel reads it, with diff and requestId", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      const todos = [
        { content: "write tests", status: "in_progress" as const },
        { content: "ship it", status: "pending" as const },
      ];
      await core.conversations.updateTodos(conversation.id, { todos, requestId: nextRequestId() });
      const tracker = await trackView(core, conversation.id);
      try {
        await waitFor(
          () => (tracker.view()?.entries ?? []).some((entry) => entry.kind === TODOS_UPDATED_KIND),
          "the todo entry",
        );
        const entries = (tracker.view()?.entries ?? []).filter((entry) => entry.kind === TODOS_UPDATED_KIND);
        expect(entries).toHaveLength(1);
        expect(entries[0]?.data).toMatchObject({ todos, requestId: expect.any(String) });
        const diff = (entries[0]?.data as { diff?: unknown } | undefined)?.diff;
        expect(Array.isArray(diff) ? diff.join("\n") : "").toContain("write tests");
      } finally {
        await tracker.stop();
      }
    });

    test("[todos] a repeated requestId is a no-op", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      const requestId = nextRequestId();
      await core.conversations.updateTodos(conversation.id, {
        todos: [{ content: "a", status: "pending" }],
        requestId,
      });
      await core.conversations.updateTodos(conversation.id, {
        todos: [{ content: "b", status: "pending" }],
        requestId,
      });
      const tracker = await trackView(core, conversation.id);
      try {
        await waitFor(
          () => (tracker.view()?.entries ?? []).some((entry) => entry.kind === TODOS_UPDATED_KIND),
          "the todo entry",
        );
        // One beat for a duplicate to show up if dedupe failed.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const entries = (tracker.view()?.entries ?? []).filter((entry) => entry.kind === TODOS_UPDATED_KIND);
        expect(entries).toHaveLength(1);
        expect(entries[0]?.data).toMatchObject({ todos: [{ content: "a", status: "pending" }] });
      } finally {
        await tracker.stop();
      }
    });

    test("[todos] updateTodos rejects bad items and an unknown thread", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "hello" });
      await rejectsWithCode(
        core.conversations.updateTodos(conversation.id, {
          todos: [{ content: "", status: "pending" }],
          requestId: nextRequestId(),
        }),
        "invalid_request",
      );
      await rejectsWithCode(
        core.conversations.updateTodos(conversation.id, {
          todos: [{ content: "x".repeat(TODO_CONTENT_MAX_LENGTH + 1), status: "pending" }],
          requestId: nextRequestId(),
        }),
        "invalid_request",
      );
      await rejectsWithCode(
        core.conversations.updateTodos(conversation.id, {
          todos: Array.from({ length: TODOS_MAX_ITEMS + 1 }, (_, index) => ({
            content: `t${index}`,
            status: "pending" as const,
          })),
          requestId: nextRequestId(),
        }),
        "invalid_request",
      );
      await rejectsWithCode(
        core.conversations.updateTodos("nope", { todos: [], requestId: nextRequestId() }),
        "not_found",
      );
    });
  });
}
