import type { ConversationView, NativeEvent, Op, SendReceipt } from "@tau/protocol";
import { baseOps, NATIVE_EVENT_ENTRY_KIND } from "@tau/protocol";

const STEP_MS = 600;

type EventBody = NativeEvent extends infer E ? (E extends unknown ? Omit<E, "key"> : never) : never;

type Listener = (ops: readonly Op[]) => Promise<void>;

const ENDING_REASONS = {
  "outcome-unknown": "The fake connection dropped.",
  blocked: "The fake run needs a decision.",
} as const;

/** A message that says "unknown" or "blocked" ends the fake run that way; any other one completes. */
function endingOf(text: string): "completed" | keyof typeof ENDING_REASONS {
  if (/unknown/i.test(text)) return "outcome-unknown";
  return /blocked/i.test(text) ? "blocked" : "completed";
}

interface Waiting {
  readonly requestId: string;
  readonly text: string;
}

/** One scripted native thread: appends `native.event` entries, one step at a time. */
export class FakeNativeThread {
  readonly id: string;
  readonly projectId: string;
  updatedAt: number;
  lastRunEndedAt: number | null = null;
  private readonly events: NativeEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly receipts = new Map<string, SendReceipt>();
  private readonly waiting: Waiting[] = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private running = false;
  private sequence = 0;

  constructor(
    id: string,
    projectId: string,
    private readonly onChange: () => void,
  ) {
    this.id = id;
    this.projectId = projectId;
    this.updatedAt = Date.now();
    this.append({ type: "session", sessionId: `fake-claude-session-${id}` });
  }

  get isRunning(): boolean {
    return this.running;
  }

  view(): ConversationView {
    const entries = this.events.map((data, index) => ({
      id: index + 1,
      kind: NATIVE_EVENT_ENTRY_KIND,
      data,
    }));
    return { conversation: { id: Number(this.id) }, entries, docs: {} } as unknown as ConversationView;
  }

  watch(listener: Listener): { stop(): Promise<void> } {
    this.listeners.add(listener);
    void listener(baseOps(this.view()));
    return {
      stop: async () => {
        this.listeners.delete(listener);
      },
    };
  }

  send(requestId: string, text: string): SendReceipt {
    const known = this.receipts.get(requestId);
    if (known) return known;
    const receipt: SendReceipt = { submissionId: 2000 + this.receipts.size };
    this.receipts.set(requestId, receipt);
    this.append({
      type: "user",
      requestId,
      receiptId: `receipt-${receipt.submissionId}`,
      text,
      delivery: "queue",
      attachmentCount: 0,
    });
    if (this.running) {
      this.append({ type: "queue", requestId, disposition: "queued" });
      this.waiting.push({ requestId, text });
    } else this.run(text);
    return receipt;
  }

  cancel(): void {
    this.clearTimers();
    for (const item of this.waiting.splice(0))
      this.append({ type: "queue", requestId: item.requestId, disposition: "cancelled" });
    if (!this.running) return;
    this.running = false;
    this.lastRunEndedAt = Date.now();
    this.append({ type: "lifecycle", lifecycle: "cancelled" });
  }

  dispose(): void {
    this.clearTimers();
    this.listeners.clear();
  }

  private run(text: string): void {
    this.running = true;
    this.append({ type: "lifecycle", lifecycle: "running" });
    this.later(() => {
      this.append({
        type: "assistant-text",
        messageId: `message-${this.sequence}`,
        partIndex: 0,
        text: `Claude Code (fake) heard: ${text}`,
      });
      this.later(() => this.finish(text));
    });
  }

  private finish(text: string): void {
    this.running = false;
    this.lastRunEndedAt = Date.now();
    const ending = endingOf(text);
    if (ending === "completed") this.appendCompleted();
    else this.append({ type: "lifecycle", lifecycle: ending, reason: ENDING_REASONS[ending] });
    const next = this.waiting.shift();
    if (!next || ending !== "completed") return;
    this.append({ type: "queue", requestId: next.requestId, disposition: "delivered" });
    this.run(next.text);
  }

  private appendCompleted(): void {
    this.append({
      type: "result",
      subtype: "success",
      isError: false,
      sessionId: `fake-claude-session-${this.id}`,
    });
    this.append({ type: "lifecycle", lifecycle: "completed" });
  }

  private later(step: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      step();
    }, STEP_MS);
    this.timers.add(timer);
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private append(event: EventBody): void {
    this.sequence += 1;
    this.events.push({ ...event, key: `fake-event-${this.sequence}` } as NativeEvent);
    this.updatedAt = Date.now();
    const ops = baseOps(this.view());
    for (const listener of [...this.listeners]) void listener(ops);
    this.onChange();
  }
}
