import type {
  ConversationSummary,
  Core,
  ModelRef,
  RuntimeCapabilities,
  StartConversationInput,
} from "@tau/protocol";
import {
  AppError,
  describeExecutors,
  emptyHandoffLosses,
  type HandoffPreview,
  nativeAttachmentsError,
  validatedHandoffInstruction,
} from "@tau/protocol";
import { FakeNativeThread } from "./fake-native-thread";

const NOT_YET = "Not supported for Claude Code threads yet.";

const FAKE_NATIVE_CAPABILITIES: RuntimeCapabilities = {
  followUp: { supported: true },
  steer: { supported: false, reason: "Native steer delivery is not supported yet." },
  approvals: { supported: false, reason: NOT_YET },
  compact: { supported: false, reason: NOT_YET },
  nativeFork: { supported: false, reason: NOT_YET },
  contextualHandoff: { supported: true },
  fileRewind: { supported: false, reason: NOT_YET },
  background: { supported: false, reason: NOT_YET },
  timers: { supported: false, reason: NOT_YET },
  delegation: { supported: false, reason: NOT_YET },
};

const FAKE_HANDOFF_PREVIEW: HandoffPreview = {
  canHandoff: true,
  losses: {
    imagesOmitted: 3,
    thinkingBlocksOmitted: 12,
    toolResultsTruncated: 2,
    turnsDropped: 0,
    compactionPresent: true,
    attachmentsOmitted: 0,
    partialTurnTrimmed: false,
    exportedChars: 1840,
  },
  preview: [
    "[user]",
    "The settings page drops my changes when I switch tabs. Can you find out why?",
    "",
    "[assistant]",
    "The tab panels unmount, so the form state is lost. I moved the draft into the parent and kept it across tabs.",
    "",
    "[tool: bash] pnpm test settings",
    "[result] 14 passed (output truncated)",
  ].join("\n"),
};

const NOT_A_PI_THREAD_REASON = "Only a Pi thread can continue in Claude Code.";

const NOT_A_PI_THREAD_PREVIEW: HandoffPreview = {
  canHandoff: false,
  reason: NOT_A_PI_THREAD_REASON,
  losses: emptyHandoffLosses(),
  preview: "",
};

const FAKE_HANDOFF_FIRST_MESSAGE = "Continue from the exported history of the previous thread.";

const hasAttachments = (input: StartConversationInput): boolean =>
  (input.images ?? []).length > 0 || (input.files ?? []).length > 0;

/**
 * `?fake=ready&native`: the fake core offers Claude Code, and a thread started with it
 * is a scripted native thread (a `native.event` view) layered over an ordinary fake thread.
 */
export function installFakeNative(core: Core): void {
  const threads = new Map<string, FakeNativeThread>();
  const models = new Map<string, ModelRef>();
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
  const handoffs = new Map<string, Promise<ConversationSummary>>();
  const announce = (projectId: string) => {
    for (const listener of listeners) listener({ resource: "conversations", projectId });
  };
  const summaryOf = (summary: ConversationSummary): ConversationSummary => {
    const thread = threads.get(summary.id);
    if (!thread) return summary;
    return {
      ...summary,
      executor: "claude-code",
      model: models.get(summary.id) ?? null,
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
    async handoffPreview(id: string) {
      const source = (await original.listAll()).find((item) => item.id === id);
      if (!source) throw new AppError("not_found", "Conversation not found.");
      return threads.has(id) ? NOT_A_PI_THREAD_PREVIEW : FAKE_HANDOFF_PREVIEW;
    },
    async handoff(id: string, input: Parameters<Core["conversations"]["handoff"]>[1]) {
      const instruction = validatedHandoffInstruction(input);
      const existing = handoffs.get(input.requestId);
      if (existing) return existing;
      const source = (await original.listAll()).find((item) => item.id === id);
      if (!source) throw new AppError("not_found", "Conversation not found.");
      if (threads.has(id)) throw new AppError("invalid_request", NOT_A_PI_THREAD_REASON);
      const created = core.conversations.start({
        projectId: source.projectId,
        text: instruction ?? FAKE_HANDOFF_FIRST_MESSAGE,
        requestId: `handoff-${input.requestId}`,
        executor: "claude-code",
      });
      handoffs.set(input.requestId, created);
      return created;
    },
    async start(input: StartConversationInput) {
      if (input.executor !== "claude-code") return original.start(input);
      if (hasAttachments(input)) throw nativeAttachmentsError();
      const shared = { ...input };
      delete shared.executor;
      const model = input.model?.provider === "claude-cli" ? input.model : undefined;
      if (model) {
        const listed = await core.models.list();
        if (!listed.some((item) => item.provider === model.provider && item.modelId === model.modelId))
          throw new AppError("invalid_request", `Unknown model: ${model.provider}/${model.modelId}`);
        // The Pi-only shadow stores identity; the scripted native thread retains the selected model.
        delete shared.model;
      }
      const shadow = await original.start(shared);
      await original.abort(shadow.id);
      if (!threads.has(shadow.id)) {
        if (model) models.set(shadow.id, model);
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
      models.delete(id);
      return original.remove(id, options);
    },
  });
}
