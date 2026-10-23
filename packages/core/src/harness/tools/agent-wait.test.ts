import type { ConversationId, ToolExecutionApi } from "@earendil-works/pi-durable";
import { describe, expect, it, vi } from "vitest";
import { withAdmissionGate } from "../conversation-submit";
import { runAndWait, submitThenWait } from "./agent-wait";

vi.mock("../subagent-status", () => ({ setAgentStatus: vi.fn(async () => undefined) }));
vi.mock("./task-answer", () => ({ finalAnswerOf: vi.fn(async () => "child answer") }));

type Settled = { readonly status: "done" | "unanswered" };
type CallContext = Parameters<ToolExecutionApi["commit"]>[1];

const CHILD_ID = 9;
const CONTEXT = {} as CallContext;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function pendingChild() {
  const finished = deferred<Settled>();
  const submitted = deferred<void>();
  const child = {
    submit: vi.fn(async () => {
      submitted.resolve();
      return { wait: vi.fn(() => finished.promise) };
    }),
  };
  return { child, submitted: submitted.promise, finishWith: (settled: Settled) => finished.resolve(settled) };
}

function fakeApi(child: unknown): ToolExecutionApi {
  const api = {
    callId: "call-1",
    conversation: vi.fn(async () => child),
    commit: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
  return api as unknown as ToolExecutionApi;
}

async function gateAcquiredWithin(conversationId: string, ms: number) {
  const acquired = withAdmissionGate(conversationId, async () => "acquired");
  return Promise.race([acquired, sleep(ms).then(() => "blocked")]);
}

describe("runAndWait admission gate", () => {
  it("releases the child gate after submit, while the child run is still pending", async () => {
    const run = pendingChild();
    const pending = runAndWait(fakeApi(run.child), CONTEXT, CHILD_ID as ConversationId, "go");
    await run.submitted;
    expect(await gateAcquiredWithin(String(CHILD_ID), 50)).toBe("acquired");
    run.finishWith({ status: "done" });
    await pending;
  });

  it("never blocks a different child id", async () => {
    const run = pendingChild();
    const pending = runAndWait(fakeApi(run.child), CONTEXT, CHILD_ID as ConversationId, "go");
    await run.submitted;
    expect(await gateAcquiredWithin(String(CHILD_ID + 1), 50)).toBe("acquired");
    run.finishWith({ status: "done" });
    await pending;
  });

  it.each([
    ["done", "done"],
    ["unanswered", "failed"],
  ] as const)("maps a wait status of %s to %s", async (waitStatus, expected) => {
    const run = pendingChild();
    const pending = runAndWait(fakeApi(run.child), CONTEXT, CHILD_ID as ConversationId, "go");
    await run.submitted;
    run.finishWith({ status: waitStatus });
    expect(await pending).toEqual({ status: expected, report: "child answer" });
  });

  it("reports failed when the child is gone", async () => {
    const result = await runAndWait(fakeApi(undefined), CONTEXT, CHILD_ID as ConversationId, "go");
    expect(result.status).toBe("failed");
  });
});

describe("submitThenWait (shared by task and agent)", () => {
  it("frees the child gate once the request is admitted and passes the request through", async () => {
    const run = pendingChild();
    const request = { type: "input", content: "go", requestId: "task:7" } as const;
    const pending = submitThenWait(fakeApi(run.child), CONTEXT, CHILD_ID as ConversationId, request);
    await run.submitted;
    expect(await gateAcquiredWithin(String(CHILD_ID), 50)).toBe("acquired");
    expect(run.child.submit).toHaveBeenCalledWith(request, CONTEXT);
    run.finishWith({ status: "done" });
    expect(await pending).toEqual({ status: "done" });
  });
});
