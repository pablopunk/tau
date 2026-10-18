import { clampThinkingLevel, type Models } from "@earendil-works/pi-ai/models";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import type { ModelRef } from "@tau/protocol";
import type { ChangeEmitter } from "../change-emitter";
import { titleFromModelAnswer } from "../conversation-title";
import { readMeta, updateLiveConversation } from "../harness/conversation-index";
import { BACKGROUND } from "../harness/open";
import type { SettingsStore } from "../home/settings-store";
import { TITLE_PROMPT } from "./title-prompt";

const TITLE_TIMEOUT_MS = 15_000;
const MAX_REQUEST_CHARS = 4000;

export interface TitleServiceDeps {
  readonly harness: Harness;
  readonly models: Models;
  readonly settings: SettingsStore;
  readonly changes: ChangeEmitter;
  readonly timeoutMs?: number;
}

export interface TitleService {
  /** Best-effort: names a conversation from its first message; failures are logged and ignored. */
  generateFor(conversationId: string, firstText: string): Promise<void>;
}

export function createTitleService(deps: TitleServiceDeps): TitleService {
  const { harness, models, settings, changes } = deps;

  async function threadModel(id: ConversationId): Promise<ModelRef | undefined> {
    const conversation = await harness.conversation(id, BACKGROUND);
    return (await conversation?.agent(BACKGROUND))?.model;
  }

  async function generateTitle(id: ConversationId, text: string): Promise<string> {
    const { fastModel, fastThinkingLevel } = await settings.get();
    const candidates = [fastModel, await threadModel(id)].filter(
      (ref): ref is ModelRef => ref !== null && ref !== undefined,
    );
    const chosen = candidates
      .map((ref) => ({ ref, model: models.getModel(ref.provider, ref.modelId) }))
      .find((found) => found.model !== undefined);
    if (!chosen?.model) throw new Error("No model is available to write a title.");
    const { model } = chosen;
    const usesFastModel = chosen.ref === fastModel;
    const reasoning =
      usesFastModel && fastThinkingLevel ? clampThinkingLevel(model, fastThinkingLevel) : undefined;
    const answer = await models.completeSimple(
      model,
      {
        systemPrompt: TITLE_PROMPT,
        messages: [{ role: "user", content: text.slice(0, MAX_REQUEST_CHARS), timestamp: Date.now() }],
      },
      {
        signal: AbortSignal.timeout(deps.timeoutMs ?? TITLE_TIMEOUT_MS),
        ...(reasoning && reasoning !== "off" && { reasoning }),
      },
    );
    if (answer.stopReason === "error" || answer.stopReason === "aborted") {
      throw new Error(answer.errorMessage ?? `The title request ended with ${answer.stopReason}.`);
    }
    const written = answer.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    const title = titleFromModelAnswer(written);
    if (!title) throw new Error("The title request returned no title.");
    return title;
  }

  async function applyTitle(id: ConversationId, title: string): Promise<void> {
    const meta = await readMeta(harness, id);
    if (!meta) return;
    const applied = await updateLiveConversation(harness, id, meta.projectId, (doc, entry) => {
      if (doc.titleSource !== "first-message") return false;
      doc.title = title;
      doc.titleSource = "generated";
      entry.title = title;
      return true;
    });
    if (applied) changes.emit({ resource: "conversations", projectId: meta.projectId });
  }

  return {
    async generateFor(conversationId, firstText) {
      try {
        const id = Number(conversationId) as ConversationId;
        await applyTitle(id, await generateTitle(id, firstText));
      } catch (error) {
        console.error("tau: could not generate a thread title", error);
      }
    },
  };
}
