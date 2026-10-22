import type { ConversationSummary, Core, RuntimeCapabilities, StartConversationInput } from "@tau/protocol";
import { describeExecutors, nativeAttachmentsError } from "@tau/protocol";
import { FakeNativeThread } from "./fake-native-thread";

const NOT_YET = "Not supported for Claude Code threads yet.";

const FAKE_NATIVE_CAPABILITIES: RuntimeCapabilities = {
  followUp: { supported: true },
  steer: { supported: false, reason: "Native steer delivery is not supported yet." },
  approvals: { supported: false, reason: NOT_YET },
  compact: { supported: false, reason: NOT_YET },
  nativeFork: { supported: false, reason: NOT_YET },
  contextualHandoff: { supported: false, reason: NOT_YET },
  fileRewind: { supported: false, reason: NOT_YET },
  background: { supported: false, reason: NOT_YET },
  timers: { supported: false, reason: NOT_YET },
  delegation: { supported: false, reason: NOT_YET },
};

const hasAttachments = (input: StartConversationInput): boolean =>
  (input.images ?? []).length > 0 || (input.files ?? []).length > 0;

/**
 * `?fake=ready&native`: the fake core offers Claude Code, and a thread started with it
 * is a scripted native thread (a `native.event` view) layered over an ordinary fake thread.
 */
export function installFakeNative(core: Core): void {
  const threads = new Map<string, FakeNativeThread>();
  const listeners = new Set<Parameters<Core["onChange"]>[0]>();
  const original = {
    start: core.conversations.start,
    list: core.conversations.list,
    listAll: core.conversations.listAll,
    send: core.conversations.send,
    abort: core.conversations.abort,
    watch: core.conversations.watch,
    remove: core.conversations.remove,
    onChange: core.onChange,
  };
  const announce = (projectId: string) => {
    for (const listener of listeners) listener({ resource: "conversations", projectId });
  };
  const summaryOf = (summary: ConversationSummary): ConversationSummary => {
    const thread = threads.get(summary.id);
    if (!thread) return summary;
    return {
      ...summary,
      executor: "claude-code",
      model: null,
      status: thread.isRunning ? "running" : "idle",
      updatedAt: thread.updatedAt,
      lastActivityAt: thread.updatedAt,
      lastRunEndedAt: thread.lastRunEndedAt,
    };
  };

  Object.assign(core.runtimes, { list: async () => describeExecutors(FAKE_NATIVE_CAPABILITIES) });
  Object.assign(core, {
    onChange: (listener: Parameters<Core["onChange"]>[0]) => {
      listeners.add(listener);
      const stop = original.onChange(listener);
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
  });
  Object.assign(core.conversations, {
    async start(input: StartConversationInput) {
      if (input.executor !== "claude-code") return original.start(input);
      if (hasAttachments(input)) throw nativeAttachmentsError();
      const shared = { ...input };
      delete shared.executor;
      const shadow = await original.start(shared);
      await original.abort(shadow.id);
      if (!threads.has(shadow.id)) {
        const thread = new FakeNativeThread(shadow.id, shadow.projectId, () => announce(shadow.projectId));
        threads.set(shadow.id, thread);
        thread.send(input.requestId, input.text);
      }
      return summaryOf(shadow);
    },
    async list(projectId: string) {
      return (await original.list(projectId)).map(summaryOf);
    },
    async listAll() {
      return (await original.listAll()).map(summaryOf);
    },
    async send(id: string, input: Parameters<Core["conversations"]["send"]>[1]) {
      const thread = threads.get(id);
      return thread ? thread.send(input.requestId, input.text) : original.send(id, input);
    },
    async abort(id: string) {
      const thread = threads.get(id);
      if (!thread) return original.abort(id);
      thread.cancel();
      return { restored: [] };
    },
    async watch(id: string, onOps: Parameters<Core["conversations"]["watch"]>[1]) {
      return threads.get(id)?.watch(onOps) ?? original.watch(id, onOps);
    },
    async remove(id: string, options?: Parameters<Core["conversations"]["remove"]>[1]) {
      threads.get(id)?.dispose();
      threads.delete(id);
      return original.remove(id, options);
    },
  });
}
