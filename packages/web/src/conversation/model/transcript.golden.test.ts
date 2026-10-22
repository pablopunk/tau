import { createHash } from "node:crypto";
import type { ConversationView, ToolCall, ToolSlot } from "@tau/protocol";
import { allFixtures, finalView, fixtureViews } from "@tau/testkit";
import { describe, expect, it } from "vitest";
import {
  durationMsOf,
  exitCodeOf,
  isActive,
  resolveToolCall,
  resultDetails,
  resultImages,
  resultText,
  wasAborted,
} from "./tool-state";
import { buildTranscript, type Transcript } from "./transcript";

const viewOf = (entries: unknown[]) => ({ entries, docs: {} }) as unknown as ConversationView;

const png = { type: "image", mimeType: "image/png", data: "aGVsbG8=" };

const userEntry = (id: number, content: unknown) => ({
  id,
  kind: "pi.user",
  model: [{ role: "user", content }],
});

const assistantEntry = (id: number, message: Record<string, unknown>) => ({
  id,
  kind: "pi.assistant",
  model: [{ role: "assistant", content: [], ...message }],
});

const toolResultEntry = (id: number, message: Record<string, unknown>, data?: unknown) => ({
  id,
  kind: "pi.tool-result",
  ...(data === undefined ? {} : { data }),
  model: [{ role: "toolResult", toolName: "bash", content: [], isError: false, ...message }],
});

const dataEntry = (id: number, kind: string, data: unknown) => ({ id, kind, data });

function callsOf(transcript: Transcript): ToolCall[] {
  return transcript.items.flatMap((item) =>
    item.kind === "assistant"
      ? item.message.content.filter((block): block is ToolCall => block.type === "toolCall")
      : [],
  );
}

const slotOf = (callId: string, status: ToolSlot["status"]) =>
  ({ callId, name: "bash", status, details: { from: "slot" } }) as unknown as ToolSlot;

function toolStatesOf(transcript: Transcript) {
  return callsOf(transcript).flatMap((call) =>
    [
      { slots: [], busy: false },
      { slots: [], busy: true },
      { slots: [slotOf(call.id, "running")], busy: true },
      { slots: [slotOf(call.id, "done")], busy: false },
    ].map((lookup) => {
      const state = resolveToolCall(call, { results: transcript.results, ...lookup });
      return {
        callId: call.id,
        busy: lookup.busy,
        slots: lookup.slots.map((slot) => slot.status),
        status: state.status,
        active: isActive(state.status),
        result: state.result,
        slot: state.slot,
        details: resultDetails(state),
      };
    }),
  );
}

function resultHelpersOf(transcript: Transcript) {
  return [...transcript.results.entries()].map(([callId, info]) => ({
    callId,
    text: resultText(info),
    images: resultImages(info),
    exitCode: exitCodeOf(info),
    aborted: wasAborted(info),
    durationMs: durationMsOf(info),
  }));
}

function goldenOf(view: ConversationView | null) {
  if (!view) return null;
  const transcript = buildTranscript(view);
  return {
    items: transcript.items,
    results: [...transcript.results.entries()],
    toolStates: toolStatesOf(transcript),
    resultHelpers: resultHelpersOf(transcript),
  };
}

const digestOf = (view: ConversationView | null) =>
  createHash("sha256")
    .update(JSON.stringify(goldenOf(view)))
    .digest("hex")
    .slice(0, 16);

const handBuilt: Record<string, ConversationView> = {
  "empty view": viewOf([]),
  "user message with images": viewOf([
    userEntry(1, [{ type: "text", text: "look" }, png, { type: "text", text: "here" }]),
    userEntry(2, "plain string"),
    userEntry(3, [png]),
  ]),
  "assistant with text, thinking and tool call": viewOf([
    assistantEntry(1, {
      model: "m",
      provider: "p",
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "running" },
        { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } },
      ],
    }),
  ]),
  "tool result with images and diagnostics": viewOf([
    assistantEntry(1, {
      content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.png" } }],
    }),
    toolResultEntry(
      2,
      {
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "<harness>note</harness>" }, { type: "text", text: "body" }, png],
        durationMs: 12,
        details: { lines: 3 },
      },
      {
        diagnostics: [
          { severity: "info", message: "exit code 3", code: "exit_code" },
          { severity: "warn", message: "stopped", code: "aborted" },
          { severity: "warn", message: "plain" },
        ],
      },
    ),
  ]),
  "tool result with isError": viewOf([
    assistantEntry(1, { content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }] }),
    toolResultEntry(2, {
      toolCallId: "call-1",
      isError: true,
      content: [{ type: "text", text: "boom" }],
      durationMs: -5,
    }),
  ]),
  "compaction entry": viewOf([
    userEntry(1, "before"),
    { id: 2, kind: "pi.compaction", head: 3, model: [] },
    userEntry(3, "after"),
  ]),
  "app.retry entry": viewOf([userEntry(1, "go"), dataEntry(2, "app.retry", { attempt: 1 })]),
  "subagent notification": viewOf([
    dataEntry(1, "app.subagent_notification", {
      childId: "kid",
      status: "done",
      title: "Scan",
      report: "ok",
    }),
    dataEntry(2, "app.subagent_notification", { childId: 1 }),
    userEntry(3, '<subagent-notification id="kid">hidden marker'),
  ]),
  "mvp notifications": viewOf([
    dataEntry(1, "app.monitor_event", {
      processId: "p1",
      description: "watch",
      lines: ["a", "b"],
      dropped: 0,
      ended: { exitCode: 0 },
    }),
    dataEntry(2, "app.process_exit", {
      processId: "p2",
      name: "dev",
      command: "pnpm dev",
      exitCode: null,
      logTail: "tail",
      origin: "bang",
      stopReason: "user",
    }),
    dataEntry(3, "app.timer_fired", {
      timerId: "t1",
      kind: "repeat",
      prompt: "poll",
      reason: null,
      source: "loop",
      firedCount: 2,
    }),
    dataEntry(4, "app.notice", { text: "heads up" }),
    dataEntry(5, "app.goal_verdict", { goalId: "g1", verdict: "met", reason: "done", turnsEvaluated: 4 }),
    dataEntry(6, "app.bang", { command: "ls" }),
    dataEntry(7, "app.notice", { text: 5 }),
    userEntry(8, "<monitor-event>hidden"),
    userEntry(9, "  <todos-updated>hidden"),
  ]),
  "streaming slot only tool call without an entry": viewOf([
    userEntry(1, "go"),
    assistantEntry(2, {
      content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "x" } }],
    }),
  ]),
  "errored assistant": viewOf([
    userEntry(1, "go"),
    assistantEntry(2, {
      stopReason: "error",
      errorMessage: "rate limited",
      content: [{ type: "text", text: "partial" }],
    }),
  ]),
  "entry without model": viewOf([
    { id: 1, kind: "pi.user" },
    { id: 2, kind: "pi.assistant" },
    { id: 3, kind: "pi.tool-result" },
    { id: 4, kind: "pi.user", model: [] },
    { id: 5, kind: "pi.system", model: [{ role: "user", content: "system" }] },
    { id: 6, kind: "unknown.kind", model: [{ role: "assistant", content: [] }] },
    { id: "str-7", kind: "pi.assistant", model: [{ role: "assistant", content: [] }] },
  ]),
  "mismatched roles": viewOf([
    { id: 1, kind: "pi.user", model: [{ role: "assistant", content: [] }] },
    { id: 2, kind: "pi.assistant", model: [{ role: "user", content: "x" }] },
    { id: 3, kind: "pi.tool-result", model: [{ role: "user", content: "x" }] },
  ]),
  "duplicate tool result ids keep the last": viewOf([
    toolResultEntry(1, { toolCallId: "dup", content: [{ type: "text", text: "first" }] }),
    toolResultEntry(2, { toolCallId: "dup", content: [{ type: "text", text: "second" }] }),
  ]),
};

describe("transcript and tool-state golden output", () => {
  for (const [name, view] of Object.entries(handBuilt)) {
    it(`hand-built: ${name}`, () => {
      expect(goldenOf(view)).toMatchSnapshot();
    });
  }

  for (const fixture of allFixtures) {
    it(`fixture ${fixture.name}: final view`, () => {
      expect(goldenOf(finalView(fixture))).toMatchSnapshot();
    });

    it(`fixture ${fixture.name}: every frame digest`, () => {
      expect(fixtureViews(fixture).map(digestOf)).toMatchSnapshot();
    });
  }
});
