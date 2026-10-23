import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConversationSummary, type ConversationView, NATIVE_EVENT_ENTRY_KIND } from "@tau/protocol";
import type { CommandEnv, SocketLike } from "./command-env";

export const TEST_URL = "http://127.0.0.1:9";
export const TEST_TOKEN = "t".repeat(40);

/** A home with a live lock; `null` leaves the URL out, as during startup. */
export function makeHome(url: string | null = TEST_URL): string {
  const home = mkdtempSync(join(tmpdir(), "tau-commands-"));
  writeFileSync(join(home, "token"), `${TEST_TOKEN}\n`);
  writeFileSync(join(home, "lock"), JSON.stringify({ pid: process.pid, url: url ?? undefined }));
  return home;
}

export function summary(id: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id,
    projectId: "p1",
    title: id,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    status: "idle",
    lastRunEndedAt: null,
    avatarIndex: 0,
    lastActivityAt: 1,
    model: null,
    workspace: { mode: "checkout" } as unknown as ConversationSummary["workspace"],
    forkOf: null,
    parentId: null,
    agentType: null,
    agentModel: null,
    agentStatus: null,
    background: false,
    agentThinking: null,
    timers: 0,
    nextTimerAt: null,
    goal: null,
    unmergedWarning: null,
    ...overrides,
  };
}

export function viewWith(answer: string, queued: readonly string[] = [], running = false): ConversationView {
  return {
    entries: [
      { id: 1, kind: "pi.user", model: [{ role: "user", content: "go" }] },
      {
        id: 2,
        kind: "pi.assistant",
        model: [{ role: "assistant", content: [{ type: "text", text: answer }] }],
      },
    ],
    docs: {
      ...(running ? { "pi.live": { run: { id: 1 } } } : {}),
      "pi.inbox": {
        items: queued.map((text, index) => ({ id: index + 1, mode: "followUp", content: text })),
      },
    },
  } as unknown as ConversationView;
}

/** A native view: one `native.event` entry per event, in order. */
export function nativeViewWith(events: readonly Record<string, unknown>[]): ConversationView {
  return {
    entries: events.map((data, index) => ({ id: index + 1, kind: NATIVE_EVENT_ENTRY_KIND, data })),
    docs: {},
  } as unknown as ConversationView;
}

export const nativeSummary = (
  id: string,
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary => summary(id, { executor: "claude-code", ...overrides });

export const lifecycleEvent = (key: string, lifecycle: string, reason?: string) => ({
  type: "lifecycle",
  key,
  lifecycle,
  ...(reason !== undefined && { reason }),
});

export const userEvent = (key: string, text: string) => ({
  type: "user",
  key,
  requestId: `r-${key}`,
  receiptId: `rc-${key}`,
  text,
  delivery: "queue",
  attachmentCount: 0,
});

export const assistantTextEvent = (key: string, text: string, messageId = "m1") => ({
  type: "assistant-text",
  key,
  messageId,
  partIndex: 0,
  text,
});

export const noticeEvent = (key: string, text: string) => ({ type: "notice", key, code: "permission", text });

export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** A scripted server: REST answers, live frames pushed by the test. */
export class FakeTau {
  summaries: ConversationSummary[] = [];
  readonly views = new Map<string, ConversationView>();
  readonly calls: RecordedCall[] = [];
  readonly sockets: SocketLike[] = [];
  readonly socketHeaders: Record<string, string>[] = [];
  readonly stdout: string[] = [];
  readonly stderr: string[] = [];
  answers = new Map<string, { status: number; body?: unknown }>();
  private inflight = 0;
  private subscriptions = 0;

  /** Resolves once a subscribe happened and no request has been in flight for a few ticks. */
  async quiet(): Promise<void> {
    let calmTicks = 0;
    while (calmTicks < 3) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      calmTicks = this.inflight === 0 && this.subscriptions > 0 ? calmTicks + 1 : 0;
    }
  }

  env(home: string, overrides: Partial<CommandEnv> = {}): CommandEnv {
    return {
      home,
      env: {},
      stdout: (text) => this.stdout.push(text),
      stderr: (text) => this.stderr.push(text),
      fetch: (input, init) => this.handle(String(input), init),
      openSocket: (_url, headers) => this.openSocket(headers),
      sleep: async () => undefined,
      after: (ms, fn) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
      now: Date.now,
      startupWaitMs: 5000,
      pollMs: 60_000,
      skillPaths: [],
      ...overrides,
    };
  }

  private async handle(url: string, init: RequestInit | undefined): Promise<Response> {
    this.inflight += 1;
    try {
      return await this.answer(url, init);
    } finally {
      this.inflight -= 1;
    }
  }

  private async answer(url: string, init: RequestInit | undefined): Promise<Response> {
    const path = url.replace(TEST_URL, "");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    this.calls.push({ method, path, headers: init?.headers as Record<string, string>, body });
    const scripted = this.answers.get(`${method} ${path}`);
    if (scripted) return jsonResponse(scripted.status, scripted.body);
    if (method === "GET" && path === "/api/conversations") return jsonResponse(200, this.summaries);
    return jsonResponse(204, undefined);
  }

  private openSocket(headers: Record<string, string>): SocketLike {
    const socket: SocketLike = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (raw) => {
        const frame = JSON.parse(raw) as { type: string; conversationId: string };
        const view = this.views.get(frame.conversationId);
        if (frame.type === "subscribe") this.subscriptions += 1;
        if (frame.type === "subscribe")
          queueMicrotask(() => this.pushView(frame.conversationId, view ?? null));
      },
      close: () => undefined,
    };
    this.sockets.push(socket);
    this.socketHeaders.push(headers);
    queueMicrotask(() => socket.onopen?.());
    return socket;
  }

  pushView(id: string, view: ConversationView | null): void {
    if (view) this.views.set(id, view);
    const data = JSON.stringify({ type: "ops", conversationId: id, ops: [["r", view]] });
    for (const socket of this.sockets) socket.onmessage?.({ data });
  }

  pushChanged(): void {
    const data = JSON.stringify({ type: "changed", resource: "conversations", projectId: "p1" });
    for (const socket of this.sockets) socket.onmessage?.({ data });
  }
}

function jsonResponse(status: number, body: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
