import type { Change, ClaudeConnectorSettings } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { createChangeEmitter } from "../change-emitter";
import { createApprovals } from "./approvals";
import type { ApprovalRequest } from "./approvals-port";

function setup(initial: ClaudeConnectorSettings = { disabled: [], alwaysAllow: [], askBeforeWrites: false }) {
  let connectors = initial;
  const changes = createChangeEmitter();
  const seen: Change[] = [];
  changes.subscribe((change) => seen.push(change));
  const approvals = createApprovals({
    settings: {
      get: async () => ({ claudeConnectors: connectors }) as never,
      setClaudeConnectors: async (value) => {
        connectors = value;
      },
    },
    changes,
    conversationOfSession: async (id) => (id === "pi-1" ? "7" : undefined),
  });
  return { approvals, seen, stored: () => connectors };
}

const requestOf = (toolUseId: string, signal = new AbortController().signal): ApprovalRequest => ({
  piSessionId: "pi-1",
  toolUseId,
  server: "Linear",
  tool: "save_comment",
  arguments: { body: "hi" },
  signal,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("approvals", () => {
  it("parks a request, lists it and emits a change, then allows once", async () => {
    const { approvals, seen, stored } = setup();
    const verdict = approvals.request(requestOf("t1"));
    await flush();
    expect(approvals.list("7").map((a) => a.toolUseId)).toEqual(["t1"]);
    expect(approvals.hasPending("7")).toBe(true);
    expect(seen).toContainEqual({ resource: "approvals", conversationId: "7" });
    await approvals.decide("7", "t1", "allow");
    expect(await verdict).toEqual({ allowed: true });
    expect(approvals.hasPending("7")).toBe(false);
    expect(stored().alwaysAllow).toEqual([]);
  });

  it("denies with a message", async () => {
    const { approvals } = setup();
    const verdict = approvals.request(requestOf("t1"));
    await flush();
    await approvals.decide("7", "t1", "deny");
    expect(await verdict).toMatchObject({ allowed: false });
  });

  it("stores the CLI tool name on allow_always and skips asking next time", async () => {
    const { approvals, stored } = setup();
    const verdict = approvals.request(requestOf("t1"));
    await flush();
    await approvals.decide("7", "t1", "allow_always");
    expect(await verdict).toEqual({ allowed: true });
    expect(stored().alwaysAllow).toEqual(["mcp__claude_ai_Linear__save_comment"]);
    expect(await approvals.request(requestOf("t2"))).toEqual({ allowed: true });
    expect(approvals.hasPending("7")).toBe(false);
  });

  it("never stores or honors an always-allow for native Claude tools", async () => {
    const { approvals, stored } = setup();
    const native = (toolUseId: string): ApprovalRequest => ({
      ...requestOf(toolUseId),
      server: "Claude Code",
      tool: "Bash",
    });
    const first = approvals.request(native("n1"));
    await flush();
    await approvals.decide("7", "n1", "allow_always");
    expect(await first).toEqual({ allowed: true });
    expect(stored().alwaysAllow).toEqual([]);
    const second = approvals.request(native("n2"));
    await flush();
    expect(approvals.hasPending("7")).toBe(true);
    await approvals.decide("7", "n2", "deny");
    expect(await second).toMatchObject({ allowed: false });
  });

  it("does not let a stored always-allow auto-allow a native tool of the same name", async () => {
    const { approvals } = setup({
      disabled: [],
      alwaysAllow: ["mcp__Claude Code__Bash", "mcp__claude_ai_Claude Code__Bash"],
      askBeforeWrites: false,
    });
    const verdict = approvals.request({ ...requestOf("n3"), server: "Claude Code", tool: "Bash" });
    await flush();
    expect(approvals.hasPending("7")).toBe(true);
    await approvals.decide("7", "n3", "deny");
    expect(await verdict).toMatchObject({ allowed: false });
  });

  it("rejects not_found for a call that is not waiting", async () => {
    const { approvals } = setup();
    await expect(approvals.decide("7", "nope", "allow")).rejects.toMatchObject({ code: "not_found" });
  });

  it("denyAll denies every pending approval of the thread", async () => {
    const { approvals } = setup();
    const first = approvals.request(requestOf("t1"));
    const second = approvals.request(requestOf("t2"));
    await flush();
    approvals.denyAll("7");
    expect(await first).toMatchObject({ allowed: false });
    expect(await second).toMatchObject({ allowed: false });
    expect(approvals.list("7")).toEqual([]);
  });

  it("an abort removes the pending entry", async () => {
    const { approvals } = setup();
    const controller = new AbortController();
    const verdict = approvals.request(requestOf("t1", controller.signal));
    await flush();
    controller.abort();
    expect(await verdict).toMatchObject({ allowed: false });
    expect(approvals.hasPending("7")).toBe(false);
  });

  it("denies a session without a thread", async () => {
    const { approvals } = setup();
    expect(await approvals.request({ ...requestOf("t1"), piSessionId: "other" })).toMatchObject({
      allowed: false,
    });
  });
});
