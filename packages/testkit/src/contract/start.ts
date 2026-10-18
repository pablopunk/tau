import type { ConversationView } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect } from "vitest";
import type { CaseRunner } from "./case-runner";
import {
  addProject,
  configure,
  entryKinds,
  JPEG_BYTES_AS_PNG,
  nextRequestId,
  rejectsWithCode,
  SECOND_MODEL,
  startConversation,
  TEXT_ONLY_MODEL,
  TINY_PNG,
  trackView,
  waitForIdle,
} from "./helpers";
import type { ContractTarget, MakeContractTarget } from "./types";

const agentDoc = (view: ConversationView | null) =>
  view?.docs["pi.agent"] as { model?: { modelId: string }; thinkingLevel?: string } | undefined;

export function startCases(make: MakeContractTarget, test: CaseRunner): void {
  describe("start", () => {
    let target: ContractTarget;
    beforeEach(async () => {
      target = await make();
    });
    afterEach(() => target.dispose());

    test("[start] runs exactly once for a repeated and a concurrent requestId", async () => {
      const { core } = target;
      await configure(core);
      const project = await addProject(target);
      const requestId = nextRequestId();
      const input = { projectId: project.id, text: "hello", requestId };
      const first = await core.conversations.start(input);
      const again = await core.conversations.start(input);
      expect(again.id).toBe(first.id);
      const concurrentId = nextRequestId();
      const [a, b] = await Promise.all([
        core.conversations.start({ ...input, requestId: concurrentId }),
        core.conversations.start({ ...input, requestId: concurrentId }),
      ]);
      expect(b.id).toBe(a.id);
      expect(await core.conversations.list(project.id)).toHaveLength(2);
      const tracker = await trackView(core, first.id);
      await waitForIdle(tracker);
      expect(entryKinds(tracker.view()).filter((kind) => kind === "pi.user")).toHaveLength(1);
      await tracker.stop();
    });

    test("[start] uses the default thinking level when none is given", async () => {
      const { core } = target;
      await configure(core);
      await core.settings.setDefaultModel({ provider: "faux", modelId: "faux-1" });
      await core.settings.setDefaultThinkingLevel("low");
      const project = await addProject(target);
      const started = await core.conversations.start({
        projectId: project.id,
        text: "hello",
        requestId: nextRequestId(),
      });
      const tracker = await trackView(core, started.id);
      const doc = agentDoc(tracker.view());
      await tracker.stop();
      expect(doc).toMatchObject({ thinkingLevel: "low" });
    });

    test("[start] creates no thread when the start is rejected", async () => {
      const { core } = target;
      await configure(core);
      const project = await addProject(target);
      const base = { projectId: project.id, requestId: nextRequestId() };
      await rejectsWithCode(core.conversations.start({ ...base, text: "   " }), "invalid_request");
      await rejectsWithCode(
        core.conversations.start({ ...base, text: "hi", model: { provider: "faux", modelId: "nope" } }),
        "invalid_request",
      );
      await rejectsWithCode(
        core.conversations.start({ ...base, text: "hi", projectId: "nope" }),
        "not_found",
      );
      expect(await core.conversations.list(project.id)).toEqual([]);
    });

    test("[start] uses the chosen model and clamps the thinking level", async () => {
      const { core } = target;
      await configure(core);
      const project = await addProject(target);
      const start = (
        model: { provider: string; modelId: string } | undefined,
        thinkingLevel?: "high" | "max",
      ) =>
        core.conversations.start({
          projectId: project.id,
          text: "hello",
          requestId: nextRequestId(),
          model,
          thinkingLevel,
        });
      const [defaulted, second, clamped] = [
        await start(undefined),
        await start(SECOND_MODEL, "high"),
        await start(undefined, "max"),
      ];
      const docs = await Promise.all(
        [defaulted, second, clamped].map(async (conversation) => {
          const tracker = await trackView(core, conversation.id);
          const doc = agentDoc(tracker.view());
          await tracker.stop();
          return doc;
        }),
      );
      expect(docs[0]).toMatchObject({ thinkingLevel: "medium" });
      expect(docs[1]).toMatchObject({ model: { modelId: "faux-2" }, thinkingLevel: "off" });
      expect(docs[2]).toMatchObject({ thinkingLevel: "high" });
    });

    test("[images] starts with an image only, and the reply counts the images", async () => {
      const { core } = target;
      const { conversation } = await startConversation(target, { text: "", images: [TINY_PNG] });
      expect(conversation.title).toBe("Image");
      const counted = await startConversation(target, {
        text: "image",
        images: [TINY_PNG],
        projectId: conversation.projectId,
      });
      const tracker = await trackView(core, counted.conversation.id);
      await waitForIdle(tracker);
      expect(JSON.stringify(tracker.view()?.entries)).toContain("Images received: 1");
      await tracker.stop();
    });

    test("[images] rejects images for a text-only model and for bytes that do not match", async () => {
      const { core } = target;
      await configure(core);
      const project = await addProject(target);
      const base = { projectId: project.id, text: "look" };
      await rejectsWithCode(
        core.conversations.start({
          ...base,
          requestId: nextRequestId(),
          images: [TINY_PNG],
          model: TEXT_ONLY_MODEL,
        }),
        "images_not_supported",
      );
      await rejectsWithCode(
        core.conversations.start({ ...base, requestId: nextRequestId(), images: [JPEG_BYTES_AS_PNG] }),
        "invalid_request",
      );
      expect(await core.conversations.list(project.id)).toEqual([]);
      const thread = await core.conversations.start({
        ...base,
        requestId: nextRequestId(),
        model: TEXT_ONLY_MODEL,
      });
      await rejectsWithCode(
        core.conversations.send(thread.id, { text: "look", images: [TINY_PNG], requestId: nextRequestId() }),
        "images_not_supported",
      );
    });
  });
}
