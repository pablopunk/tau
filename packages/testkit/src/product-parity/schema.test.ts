import { describe, expect, it } from "vitest";
import ledger from "./operations.json";
import { type ProductParityRow, parseParityRows } from "./schema";

function row(): ProductParityRow {
  return {
    id: "C.send-B",
    operationId: "route.sendMessage",
    transport: "rest",
    scenarioId: "C.collision",
    assertionIds: ["C.remote-effect"],
    route: "sendMessage",
    initialSeed: { version: 1, seed: 15158, fixtureId: "small-v1" },
    web: { caller: "Composer", gesture: "Send", input: { text: "synthetic" } },
    cli: { command: "threads send", argv: ["thread7", "synthetic"], input: { text: "synthetic" } },
    target: { nodeId: "B", threadId: "thread7", requestId: "C.send-1", submissionId: 1 },
    executor: "pi",
    capability: "followUp",
    permissions: { decision: "not-required", confirmed: false },
    receipt: { submissionId: 1 },
    terminal: { lifecycle: null, observation: null, effect: "unknown" },
    persistedEffects: [],
    forbiddenEffects: ["A.thread7.changed"],
    evidence: {
      status: "unverified",
      kind: "static",
      sourceRefs: ["packages/web/src/lib/api.ts:414"],
      assertions: [],
    },
  };
}

describe("parity records", () => {
  it("reuses public receipt and opaque target identities", () => {
    expect(parseParityRows([row()])[0]?.receipt).toEqual({ submissionId: 1 });
  });
  it("accepts the existing native admission receipt without converting its identity", () => {
    const value = row();
    value.executor = "claude-code";
    value.receipt = {
      receiptId: "thread7:1",
      threadId: "thread7",
      requestId: "C.send-1",
      executor: "claude-code",
      epoch: 0,
      payloadIdentity: "fingerprinted",
      admittedAt: 0,
    };
    expect(parseParityRows([value])[0]?.receipt).toEqual(value.receipt);
  });
  it("rejects incomplete rows and unknown routes", () => {
    expect(() => parseParityRows([{}])).toThrow("invalid_parity_rows");
    expect(() => parseParityRows([{ ...row(), route: "not-a-route" }])).toThrow("unknown_parity_route");
  });
  it.each([...ledger.streams, ...ledger.browserGestures])(
    "accepts known non-REST operation $id with its own transport and a null route",
    ({ id: operationId, transport }) => {
      const value = { ...row(), operationId, transport, route: null, receipt: null };
      expect(parseParityRows([value])[0]).toMatchObject({ operationId, transport, route: null });
    },
  );
  it("binds every REST operation to the existing route named by its ledger identity", () => {
    for (const { id: operationId, route, transport } of ledger.operations) {
      expect(parseParityRows([{ ...row(), operationId, route, transport }])[0]?.operationId).toBe(
        operationId,
      );
    }
  });
  it.each([
    { operationId: "live.not-known", transport: "live", route: null },
    { operationId: "terminal.not-known", transport: "terminal", route: null },
    { operationId: "gesture.not-known", transport: "gesture", route: null },
    { operationId: "route.not-known", transport: "rest", route: "sendMessage" },
  ])("rejects unknown ledger identity $operationId", (identity) => {
    expect(() => parseParityRows([{ ...row(), ...identity }])).toThrow("unknown_parity_operation");
  });
  it.each([
    { operationId: "live.subscribe", transport: "terminal", route: null },
    { operationId: "terminal.attach", transport: "live", route: null },
    { operationId: "gesture.terminal-rendering", transport: "terminal", route: null },
    { operationId: "route.openTerminal", transport: "terminal", route: null },
    { operationId: "terminal.attach", transport: "rest", route: "openTerminal" },
    { operationId: "route.sendMessage", transport: "rest", route: "openTerminal" },
  ])("rejects wrong transport/route for $operationId as $transport", (identity) => {
    expect(() => parseParityRows([{ ...row(), ...identity }])).toThrow("mismatched_parity_operation");
  });
  it.each([
    { operationId: "terminal.attach", transport: "terminal", route: "openTerminal" },
    { operationId: "live.subscribe", transport: "live", route: "sendMessage" },
    { operationId: "gesture.file-picker", transport: "gesture", route: "stageUpload" },
    { operationId: "route.sendMessage", transport: "rest", route: null },
    { operationId: "terminal.attach", transport: "websocket", route: null },
  ])("rejects invalid discriminator/route shape for $operationId", (identity) => {
    expect(() => parseParityRows([{ ...row(), ...identity }])).toThrow("invalid_parity_rows");
  });
  it("requires operationId and transport, independently of assertion-record id", () => {
    const { operationId: _operationId, ...missingOperation } = row();
    const { transport: _transport, ...missingTransport } = row();
    expect(() => parseParityRows([missingOperation])).toThrow("invalid_parity_rows");
    expect(() => parseParityRows([missingTransport])).toThrow("invalid_parity_rows");
    expect(parseParityRows([row(), { ...row(), id: "C.second-observation" }])).toHaveLength(2);
  });
  it("rejects duplicate rows, duplicate assertions and undeclared evidence", () => {
    expect(() => parseParityRows([row(), row()])).toThrow("duplicate_parity_row");
    const value = row();
    value.evidence.assertions = [
      { id: "C.remote-effect", status: "PASS" },
      { id: "C.remote-effect", status: "PASS" },
    ];
    expect(() => parseParityRows([value])).toThrow("duplicate_parity_assertion");
    value.evidence.assertions = [{ id: "C.other", status: "PASS" }];
    expect(() => parseParityRows([value])).toThrow("undeclared_parity_assertion");
  });
  it("allows a completed explanation of denial but never claims the edit applied", () => {
    const value = row();
    value.permissions.decision = "deny";
    value.terminal = { lifecycle: "completed", observation: "thread-idle", effect: "denied" };
    expect(parseParityRows([value])).toHaveLength(1);
    value.terminal.effect = "applied";
    expect(() => parseParityRows([value])).toThrow("denied_effect_claimed_applied");
  });
  it("keeps colliding thread ids distinct by node", () => {
    const a = row();
    a.id = "C.send-A";
    a.target.nodeId = "A";
    expect(parseParityRows([a, row()]).map((item) => item.target.nodeId)).toEqual(["A", "B"]);
  });
});
