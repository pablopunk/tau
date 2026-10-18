import {
  type Api,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ClaudeCliClock } from "../clock";
import type { PlanUsage } from "../plan-usage";
import type { ClaudeSdkLoader } from "../sdk-types";
import { createBinding } from "./binding";
import { type CallContext, readCallContext } from "./call-context";
import { choosePath } from "./choose-path";
import { neutralText, THREAD_CLOSED_TEXT } from "./errors";
import { emptyAssistantMessage, finalEvent } from "./finish";
import { cancelIdle, closeQuery } from "./lifecycle";
import { runBound } from "./run-bound";
import { runOneShot } from "./run-one-shot";
import { createRuntime, type Runtime } from "./runtime";

export interface ClaudeCliStreamDeps {
  readonly sdk: ClaudeSdkLoader;
  readonly planUsage: PlanUsage;
  readonly clock: ClaudeCliClock;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Called with `modelUsage.contextWindow` for a model value. */
  readonly noteContextWindow: (modelValue: string, contextWindow: number) => void;
  /** Called when the detector must check again (an auth error). */
  readonly onAuthError: () => void;
  /** The number of live SDK processes changed. */
  readonly onProcessCount: (count: number) => void;
}

export interface ClaudeCliStreamer {
  streamSimple(
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
  /** Archive and delete: close the query of a Pi session at once. */
  closeThread(piSessionId: string): Promise<void>;
  /** Shutdown. */
  closeAll(): Promise<void>;
  processCount(): number;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function runCall(
  rt: Runtime,
  call: CallContext,
  stream: AssistantMessageEventStream,
  sequence: number,
): Promise<void> {
  const message = emptyAssistantMessage(call.model, rt.deps.clock.now());
  if (call.signal?.aborted) {
    stream.push(finalEvent(message, { kind: "aborted" }, null));
    return;
  }
  const existing = call.sessionId ? rt.bindings.get(call.sessionId) : undefined;
  await existing?.settling;
  const plan = choosePath({
    hasTools: call.tools.length > 0,
    binding: existing,
    entries: call.entries,
    hashes: call.hashes,
    effort: call.effort,
  });
  if (plan.kind === "oneShot") return runOneShot(rt, call, message, stream, sequence);
  const id = call.sessionId ?? `anonymous-${sequence}`;
  const binding = existing ?? createBinding(id, call.modelValue);
  rt.bindings.set(id, binding);
  return runBound(rt, binding, plan, call, message, stream);
}

async function deleteCreatedSessions(rt: Runtime, sessions: ReadonlySet<string>): Promise<void> {
  if (sessions.size === 0) return;
  const port = await rt.port().catch(() => null);
  await Promise.all([...sessions].map((id) => port?.deleteSession(id).catch(() => undefined)));
}

export function createClaudeCliStream(deps: ClaudeCliStreamDeps): ClaudeCliStreamer {
  const rt = createRuntime(deps);
  let sequence = 0;
  return {
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      sequence += 1;
      const call = readCallContext(model, context, options);
      runCall(rt, call, stream, sequence).catch((error: unknown) => {
        const message = emptyAssistantMessage(model, deps.clock.now());
        const failed = { kind: "failed", text: neutralText(messageOf(error)), failure: "other" } as const;
        stream.push(finalEvent(message, failed, null));
      });
      return stream;
    },
    async closeThread(piSessionId) {
      const binding = rt.bindings.get(piSessionId);
      if (!binding) return;
      rt.bindings.delete(piSessionId);
      cancelIdle(binding);
      binding.listener?.fail(THREAD_CLOSED_TEXT);
      closeQuery(rt, binding);
      await deleteCreatedSessions(rt, binding.created);
      binding.created.clear();
    },
    async closeAll() {
      for (const binding of [...rt.live]) {
        cancelIdle(binding);
        binding.listener?.fail(THREAD_CLOSED_TEXT);
        closeQuery(rt, binding);
      }
      for (const binding of rt.bindings.values()) cancelIdle(binding);
    },
    processCount: () => rt.live.size,
  };
}
