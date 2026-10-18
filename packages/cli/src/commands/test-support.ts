import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationSummary, ConversationView } from "@tau/protocol";
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
    unmergedWarning: null,
    ...overrides,
  };
}

export function viewWith(answer: string, queued: readonly string[] = []): ConversationView {
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
      "pi.inbox": {
        items: queued.map((text, index) => ({ id: index + 1, mode: "followUp", content: text })),
      },
    },
  } as unknown as ConversationView;
}

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
