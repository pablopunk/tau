import type { Binding } from "./binding";
import type { CallContext } from "./call-context";
import type { Plan } from "./choose-path";
import { contentOfEntries, prependText } from "./content";
import { continueLive } from "./deliver";
import { launchQuery } from "./launch";
import { closeQuery } from "./lifecycle";
import type { Entry } from "./normalize";
import { renderRebindTranscript } from "./rebind-transcript";
import type { Runtime } from "./runtime";

const notSystem = (entries: readonly Entry[]) => entries.filter(({ message }) => message.role !== "system");

function rebindContent(entries: readonly Entry[]) {
  const lastAssistant = entries.map(({ message }) => message.role).lastIndexOf("assistant");
  const history = notSystem(entries.slice(0, lastAssistant + 1));
  const tail = contentOfEntries(notSystem(entries.slice(lastAssistant + 1)));
  return history.length === 0 ? tail : prependText(renderRebindTranscript(history), tail);
}

async function interruptAndClose(rt: Runtime, binding: Binding): Promise<void> {
  await binding.query?.interrupt().catch(() => undefined);
  closeQuery(rt, binding);
}

/** Brings the binding's SDK session to the state the plan describes and delivers the new messages. */
export async function prepare(
  rt: Runtime,
  binding: Binding,
  plan: Exclude<Plan, { kind: "oneShot" }>,
  call: CallContext,
): Promise<void> {
  if (plan.kind === "continue") return continueLive(rt, binding, call, plan.suffix);
  if (plan.kind === "resume") {
    closeQuery(rt, binding);
    const resume = binding.sdkSessionId ?? undefined;
    return launchQuery(rt, binding, call, {
      content: contentOfEntries(plan.suffix),
      resume,
      keepCheckpoints: true,
    });
  }
  await interruptAndClose(rt, binding);
  if (plan.kind === "resumeAt") {
    return launchQuery(rt, binding, call, {
      content: contentOfEntries(plan.suffix),
      resume: binding.sdkSessionId ?? undefined,
      resumeSessionAt: plan.checkpoint.sdkUuid ?? undefined,
      forkSession: true,
      keepCheckpoints: false,
    });
  }
  return launchQuery(rt, binding, call, { content: rebindContent(call.entries), keepCheckpoints: false });
}
