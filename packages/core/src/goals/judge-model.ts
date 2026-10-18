import { clampThinkingLevel, type Models } from "@earendil-works/pi-ai/models";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import type { ModelRef } from "@tau/protocol";
import { BACKGROUND } from "../harness/open";
import type { SettingsStore } from "../home/settings-store";

const JUDGE_TIMEOUT_MS = 60_000;

export type JudgeAnswer = { text: string; tokens: number };

/** Asks the judge model one question. Throws an Error with the provider's message when the request fails. */
export type AskJudge = (
  conversationId: string,
  request: { system: string; user: string; signal?: AbortSignal },
) => Promise<JudgeAnswer>;

export interface JudgeModelDeps {
  readonly harness: Harness;
  readonly models: Models;
  readonly settings: SettingsStore;
}

/** Settings fast model, else the thread's model, as the title service does. */
export function createJudgeModel(deps: JudgeModelDeps): AskJudge {
  const { harness, models, settings } = deps;

  async function threadModel(id: ConversationId): Promise<ModelRef | undefined> {
    const conversation = await harness.conversation(id, BACKGROUND);
    return (await conversation?.agent(BACKGROUND))?.model;
  }

  return async (conversationId, { system, user, signal }) => {
    const { fastModel, fastThinkingLevel } = await settings.get();
    const candidates = [fastModel, await threadModel(Number(conversationId) as ConversationId)].filter(
      (ref): ref is ModelRef => ref !== null && ref !== undefined,
    );
    const chosen = candidates
      .map((ref) => ({ ref, model: models.getModel(ref.provider, ref.modelId) }))
      .find((found) => found.model !== undefined);
    if (!chosen?.model) throw new Error("No such model is available to check the goal.");
    const reasoning =
      chosen.ref === fastModel && fastThinkingLevel
        ? clampThinkingLevel(chosen.model, fastThinkingLevel)
        : undefined;
    const timeout = AbortSignal.timeout(JUDGE_TIMEOUT_MS);
    const answer = await models.completeSimple(
      chosen.model,
      { systemPrompt: system, messages: [{ role: "user", content: user, timestamp: Date.now() }] },
      {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        ...(reasoning && reasoning !== "off" && { reasoning }),
      },
    );
    if (answer.stopReason === "error" || answer.stopReason === "aborted") {
      throw new Error(answer.errorMessage ?? `The goal check ended with ${answer.stopReason}.`);
    }
    const text = answer.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    return { text, tokens: answer.usage?.totalTokens ?? 0 };
  };
}
