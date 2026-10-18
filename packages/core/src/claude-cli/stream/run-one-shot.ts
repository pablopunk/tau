import { tmpdir } from "node:os";
import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createBinding } from "./binding";
import type { CallContext } from "./call-context";
import { neutralText } from "./errors";
import { finalEvent } from "./finish";
import { closeQuery } from "./lifecycle";
import { type Entry, textOfBlocks } from "./normalize";
import { pump } from "./pump";
import { buildQueryOptions } from "./query-options";
import { renderRebindTranscript } from "./rebind-transcript";
import type { Runtime } from "./runtime";
import { createTurn } from "./turn";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function oneShotPrompt(entries: readonly Entry[]): string {
  const conversation = entries.filter(({ message }) => message.role !== "system");
  const [only] = conversation;
  if (conversation.length === 1 && only?.message.role === "user") return textOfBlocks(only.message.content);
  return renderRebindTranscript(conversation);
}

/** Compaction, titles and the goal judge: a fresh query, nothing saved, one turn, no tools. */
export async function runOneShot(
  rt: Runtime,
  call: CallContext,
  message: AssistantMessage,
  stream: AssistantMessageEventStream,
  sequence: number,
): Promise<void> {
  const binding = createBinding(`one-shot-${sequence}`, call.modelValue);
  const turn = createTurn(message, (event) => stream.push(event));
  binding.listener = turn;
  const onAbort = () => {
    turn.abort();
    void binding.query?.interrupt().catch(() => undefined);
  };
  call.signal?.addEventListener("abort", onAbort, { once: true });
  if (call.signal?.aborted) onAbort();
  try {
    const port = await rt.port();
    if (!turn.isSettled()) {
      const query = port.startQuery(
        buildQueryOptions({
          prompt: oneShotPrompt(call.entries),
          model: call.modelValue,
          cwd: tmpdir(),
          systemPrompt: call.systemPrompt,
          env: rt.deps.env,
          title: "tau · one-shot",
          reasoning: call.reasoning,
          persistSession: false,
          maxTurns: 1,
        }),
      );
      binding.query = query;
      rt.live.add(binding);
      rt.notifyProcesses();
      pump(rt, binding, query);
    }
  } catch (error) {
    turn.fail(neutralText(messageOf(error)));
  }
  const outcome = await turn.outcome;
  call.signal?.removeEventListener("abort", onAbort);
  binding.listener = null;
  closeQuery(rt, binding);
  stream.push(finalEvent(message, outcome, binding.latestResetsAt));
}
