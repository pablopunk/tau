import { CONNECTOR_TOOL_NAME } from "../connectors/names";
import type { ClaudeContentBlock } from "../sdk-types";
import type { Binding } from "./binding";
import type { CallContext } from "./call-context";
import type { Plan } from "./choose-path";
import { withoutConnectorResults } from "./connector-filter";
import { contentOfEntries, prependText } from "./content";
import { continueLive } from "./deliver";
import { launchQuery } from "./launch";
import { closeQuery } from "./lifecycle";
import type { Entry } from "./normalize";
import { renderRebindTranscript } from "./rebind-transcript";
import type { Runtime } from "./runtime";

export const CONTINUE_TEXT = "Continue.";

type Content = string | ClaudeContentBlock[];

const notSystem = (entries: readonly Entry[]) => entries.filter(({ message }) => message.role !== "system");

const isConnectorResult = ({ message }: Entry): boolean =>
  message.role === "toolResult" && message.toolName === CONNECTOR_TOOL_NAME;

/** The history ends after the last assistant message and the connector results that follow it. */
function historyEnd(entries: readonly Entry[]): number {
  let end = entries.map(({ message }) => message.role).lastIndexOf("assistant") + 1;
  while (end > 0 && end < entries.length && isConnectorResult(entries[end] as Entry)) end += 1;
  return end;
}

function rebindContent(entries: readonly Entry[]) {
  const end = historyEnd(entries);
  const history = notSystem(entries.slice(0, end));
  const tail = contentOfEntries(notSystem(entries.slice(end)));
  return history.length === 0 ? tail : prependText(renderRebindTranscript(history), tail);
}

/** The user text to resume with: the new messages, or a nudge when only the CLI's own next message is owed. */
function resumeContent(binding: Binding, suffix: readonly Entry[]): Content | null {
  const kept = withoutConnectorResults(binding, suffix);
  if (kept.length > 0) return contentOfEntries(kept);
  return binding.connectorTail ? CONTINUE_TEXT : null;
}

function resumeAtContent(binding: Binding, suffix: readonly Entry[]): Content | null {
  const kept = withoutConnectorResults(binding, suffix);
  return kept.length > 0 ? contentOfEntries(kept) : null;
}

async function interruptAndClose(rt: Runtime, binding: Binding): Promise<void> {
  await binding.query?.interrupt().catch(() => undefined);
  closeQuery(rt, binding);
}

const rebind = (rt: Runtime, binding: Binding, call: CallContext): Promise<void> =>
  launchQuery(rt, binding, call, { content: rebindContent(call.entries), keepCheckpoints: false });

async function resume(
  rt: Runtime,
  binding: Binding,
  call: CallContext,
  suffix: readonly Entry[],
): Promise<void> {
  closeQuery(rt, binding);
  const content = resumeContent(binding, suffix);
  if (content === null) return rebind(rt, binding, call);
  return launchQuery(rt, binding, call, {
    content,
    resume: binding.sdkSessionId ?? undefined,
    keepCheckpoints: true,
  });
}

async function resumeAt(
  rt: Runtime,
  binding: Binding,
  call: CallContext,
  plan: Extract<Plan, { kind: "resumeAt" }>,
): Promise<void> {
  await interruptAndClose(rt, binding);
  const content = resumeAtContent(binding, plan.suffix);
  if (content === null) return rebind(rt, binding, call);
  return launchQuery(rt, binding, call, {
    content,
    resume: binding.sdkSessionId ?? undefined,
    resumeSessionAt: plan.checkpoint.sdkUuid ?? undefined,
    forkSession: true,
    keepCheckpoints: false,
  });
}

/** A persisted session can be gone (user wiped `~/.claude`, SDK pruned it): fall back to a rebind. */
const isStaleSession = (error: unknown): boolean =>
  /no conversation found|session.*not found|unknown session|resume.*fail/i.test(
    error instanceof Error ? `${error.message} ${error.cause ?? ""}` : String(error),
  );

/** Brings the binding's SDK session to the state the plan describes and delivers the new messages. */
export async function prepare(
  rt: Runtime,
  binding: Binding,
  plan: Exclude<Plan, { kind: "oneShot" }>,
  call: CallContext,
): Promise<void> {
  if (plan.kind === "continue") return continueLive(rt, binding, call, plan.suffix);
  if (plan.kind === "resume") {
    try {
      return await resume(rt, binding, call, plan.suffix);
    } catch (error) {
      if (!isStaleSession(error)) throw error;
      binding.sdkSessionId = null;
      binding.checkpoints = [];
      binding.head = null;
      rt.persistBinding(binding);
      return rebind(rt, binding, call);
    }
  }
  if (plan.kind === "resumeAt") {
    try {
      return await resumeAt(rt, binding, call, plan);
    } catch (error) {
      if (!isStaleSession(error)) throw error;
      binding.sdkSessionId = null;
      binding.checkpoints = [];
      binding.head = null;
      rt.persistBinding(binding);
      return rebind(rt, binding, call);
    }
  }
  await interruptAndClose(rt, binding);
  return rebind(rt, binding, call);
}
