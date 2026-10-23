import { COMMAND_EXCLUSIONS, commands, routes } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { checkParityCoverage } from "./coverage";
import ledger from "./operations.json";
import type { ProductParityRow } from "./schema";

function row(status: "PASS" | "FAIL" | "BLOCKED" | "UNSUPPORTED" = "PASS"): ProductParityRow {
  return {
    id: "C.row",
    operationId: "route.sendMessage",
    transport: "rest",
    scenarioId: "C.send",
    assertionIds: ["C.effect"],
    route: "sendMessage",
    initialSeed: { version: 1, seed: 15158, fixtureId: "small-v1" },
    web: { caller: "Composer", gesture: "Send", input: {} },
    cli: { command: "threads send", argv: [], input: {} },
    target: { nodeId: "B", threadId: "thread7", requestId: "C.1", submissionId: null },
    executor: "pi",
    capability: "followUp",
    permissions: { decision: "allow", confirmed: true },
    receipt: null,
    terminal: { lifecycle: "completed", observation: "thread-idle", effect: "none" },
    persistedEffects: [],
    forbiddenEffects: [],
    evidence: {
      status: "proved",
      kind: "synthetic",
      sourceRefs: ["owned-test"],
      assertions: [{ id: "C.effect", status }],
    },
  };
}

describe("parity evidence coverage, not an executor", () => {
  it("never qualifies an empty or missing required case", () => {
    expect(checkParityCoverage([], []).verdict).toBe("BLOCKED");
    expect(checkParityCoverage([], ["C.effect"]).blocked).toEqual(["C.effect"]);
    expect(checkParityCoverage([row()], ["C.effect", "C.missing"]).verdict).toBe("BLOCKED");
  });
  it("counts only required asserted evidence", () => {
    expect(checkParityCoverage([row()], ["C.effect"])).toMatchObject({
      verdict: "PASS",
      required: 1,
      asserted: 1,
      passed: 1,
    });
  });
  it("does not turn static classification or an unsupported assertion into success", () => {
    const value = row();
    value.evidence.kind = "static";
    expect(checkParityCoverage([value], ["C.effect"]).verdict).toBe("BLOCKED");
    for (const status of ["BLOCKED", "UNSUPPORTED"] as const) {
      expect(checkParityCoverage([row(status)], ["C.effect"]).asserted).toBe(0);
    }
  });
  it("fails explicit assertion failures even alongside missing evidence", () => {
    expect(checkParityCoverage([row("FAIL")], ["C.effect", "C.missing"]).verdict).toBe("FAIL");
  });
  it("preserves a required failure when PASS and FAIL rows ambiguously own the same assertion", () => {
    const failed = { ...row("FAIL"), id: "C.node-A", target: { ...row().target, nodeId: "A" } };
    const passed = { ...row("PASS"), id: "C.node-B", target: { ...row().target, nodeId: "B" } };
    for (const rows of [
      [failed, passed],
      [passed, failed],
    ]) {
      expect(checkParityCoverage(rows, ["C.effect"])).toEqual({
        verdict: "FAIL",
        required: 1,
        asserted: 1,
        passed: 0,
        failed: ["C.effect"],
        blocked: ["C.effect"],
      });
    }
  });
  it("keeps failure precedence across repeated assertions on distinct non-REST operations", () => {
    const terminal: ProductParityRow = {
      ...row("FAIL"),
      id: "C.input",
      operationId: "terminal.input",
      transport: "terminal",
      route: null,
    };
    const live: ProductParityRow = {
      ...row(),
      id: "C.live",
      operationId: "live.subscribe",
      transport: "live",
      route: null,
    };
    const gesture: ProductParityRow = {
      ...row(),
      id: "C.gesture",
      operationId: "gesture.terminal-rendering",
      transport: "gesture",
      route: null,
    };
    for (const rows of [
      [terminal, live, gesture],
      [gesture, live, terminal],
    ]) {
      expect(checkParityCoverage(rows, ["C.effect"])).toEqual({
        verdict: "FAIL",
        required: 1,
        asserted: 1,
        passed: 0,
        failed: ["C.effect"],
        blocked: ["C.effect"],
      });
    }
    gesture.evidence.kind = "static";
    expect(checkParityCoverage([gesture], ["C.effect"]).verdict).toBe("BLOCKED");
  });
  it("retains failed evidence alongside a different ambiguously owned required assertion", () => {
    const ambiguous = (id: string): ProductParityRow => ({
      ...row(),
      id,
      assertionIds: ["C.ambiguous"],
      evidence: { ...row().evidence, assertions: [{ id: "C.ambiguous", status: "PASS" }] },
    });
    expect(
      checkParityCoverage([row("FAIL"), ambiguous("C.A"), ambiguous("C.B")], ["C.effect", "C.ambiguous"]),
    ).toEqual({
      verdict: "FAIL",
      required: 2,
      asserted: 1,
      passed: 0,
      failed: ["C.effect"],
      blocked: ["C.ambiguous"],
    });
  });
  it("blocks ambiguous assertion ownership and rejects duplicate required ids", () => {
    expect(checkParityCoverage([row(), { ...row(), id: "C.second" }], ["C.effect"]).verdict).toBe("BLOCKED");
    expect(() => checkParityCoverage([], ["C.x", "C.x"])).toThrow("invalid_required_assertion_ids");
  });
});

describe("starting operation ledger", () => {
  it("inventories every REST route once, without claiming executable proof", () => {
    expect(ledger.operations.map((row) => row.route).sort()).toEqual(Object.keys(routes).sort());
    const all = [...ledger.operations, ...ledger.streams, ...ledger.browserGestures];
    expect(new Set(all.map((row) => row.id)).size).toBe(all.length);
    for (const row of [...ledger.streams, ...ledger.browserGestures]) {
      expect(row.route).toBeNull();
      expect(row.transport).toBe(row.id.split(".")[0]);
    }
    for (const row of ledger.operations) {
      expect(row.transport).toBe("rest");
      expect(row.id).toBe(`route.${row.route}`);
      expect(row.evidence.status).toBe("classified");
      expect(row.evidence.kind).toBe("static");
      expect(row.receipt).toBeNull();
      expect(row.terminalObservation).toBeNull();
      expect(row.assertionIds.length).toBeGreaterThan(0);
      expect(row.scenarioIds.length).toBeGreaterThan(0);
    }
  });
  it("maps destructured Core aliases and records server-only routes explicitly", () => {
    expect(ledger.operations.filter((row) => row.coreMethod === null).map((row) => row.route)).toEqual([
      "getHealth",
      "getMetrics",
      "linkNode",
    ]);
    expect(ledger.operations.find((row) => row.route === "signOutAllDevices")?.coreMethod).toBe(
      "Core.access.signOutAll",
    );
    expect(ledger.operations.find((row) => row.route === "updateTodos")?.coreMethod).toBe(
      "Core.conversations.updateTodos",
    );
    expect(ledger.operations.find((row) => row.route === "openTerminal")?.coreMethod).toBe(
      "Core.terminals.open",
    );
  });
  it("distinguishes typed node removal and directory dispatch from generic table metadata", () => {
    const remove = ledger.operations.find((row) => row.route === "removeNode");
    expect(remove?.coreMethod).toBe("Core.nodes.group.createExpel");
    expect(remove?.confirmation).toContain("--confirm");
    expect(remove?.confirmation).toContain("--yes is insufficient");
    expect(ledger.operations.find((row) => row.route === "listNodes")?.cliMapping).not.toContain(
      "nodes list",
    );
    expect(ledger.operations.find((row) => row.route === "getNodeDirectory")?.cliMapping).toContain(
      "nodes list",
    );
  });
  it("records actual dedicated actions, targets and response transformations instead of table assumptions", () => {
    const audit = ledger.dedicatedOverrides;
    expect(audit.map((entry) => entry.id)).toEqual(ledger.specialCommands.overrideAuditIds);
    expect(new Set(audit.map((entry) => entry.id)).size).toBe(17);
    for (const entry of audit) {
      expect(entry.action.length).toBeGreaterThan(0);
      expect(entry.target.length).toBeGreaterThan(0);
      expect(entry.responseDescription.length).toBeGreaterThan(0);
      expect(entry.sourceRefs.length).toBeGreaterThan(0);
      expect(entry.evidence).toContain("not execution proof");
    }
    expect(audit.find((entry) => entry.id === "nodes-list")?.primaryRoutes).toEqual(["getNodeDirectory"]);
    expect(audit.find((entry) => entry.id === "nodes-remove")).toMatchObject({
      primaryRoutes: ["getNodeDirectory", "removeNode"],
      confirmation: "typed --confirm <exact name or id> required; --yes is insufficient",
    });
    expect(audit.find((entry) => entry.id === "access-rotate")?.confirmation).toContain(
      "interactive approval",
    );
    expect(audit.find((entry) => entry.id === "handoff-create")?.primaryRoutes).toEqual([
      "handoffConversation",
    ]);
    expect(audit.find((entry) => entry.id === "handoff-preview")?.primaryRoutes).toEqual([
      "getHandoffPreview",
    ]);
    expect(audit.find((entry) => entry.id === "pair-new")?.primaryRoutes).toEqual(["mintPairing"]);
    expect(audit.find((entry) => entry.id === "connect-node")?.target).toContain("explicit remote peer URL");
    expect(audit.find((entry) => entry.id === "disconnect-peer")?.responseDescription).toContain(
      "failures swallowed",
    );
    expect(audit.find((entry) => entry.id === "metrics")?.primaryRoutes).toEqual(["getMetrics"]);
    for (const id of ["status", "update-check", "update-install"]) {
      expect(audit.find((entry) => entry.id === id)?.primaryRoutes).toEqual([]);
      expect(audit.find((entry) => entry.id === id)?.equivalence).toContain("partial");
    }
  });
  it("records the command table and reclassifies every exclusion", () => {
    for (const command of commands) {
      expect(ledger.operations.find((row) => row.route === command.route)?.cliMapping).toContain(
        command.command,
      );
    }
    for (const route of Object.keys(COMMAND_EXCLUSIONS)) {
      expect(ledger.operations.find((row) => row.route === route)?.classification).toMatch(
        /^(dedicated|gesture|missing)$/,
      );
    }
    for (const route of [
      "setProjectIcon",
      "resetProjectIcon",
      "signOutAllDevices",
      "updateTodos",
      "recreateRemote",
      "openTerminal",
      "stageUpload",
    ]) {
      expect(ledger.operations.find((row) => row.route === route)?.classification).toBe("generic");
    }
  });
});
