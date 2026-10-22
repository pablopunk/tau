import { RUNTIME_LIFECYCLES, type RuntimeLifecycle, type WriterState } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { combineWriterStates, nextLifecycle, settleOperation } from "./runtime-lifecycle";

const TERMINAL: RuntimeLifecycle[] = ["completed", "failed", "cancelled", "interrupted", "outcome-unknown"];

const LEGAL: Array<[RuntimeLifecycle, RuntimeLifecycle[]]> = [
  ["accepted", ["preparing"]],
  ["preparing", ["ready", "blocked", "failed", "cancelling"]],
  ["ready", ["starting", "cancelling"]],
  ["starting", ["running", "blocked", "failed", "cancelling"]],
  ["running", ["completed", "failed", "cancelling"]],
  ["blocked", ["preparing", "cancelled", "failed"]],
  ["cancelling", ["cancelled", "interrupted", "outcome-unknown"]],
  ["reconciling", ["running", "completed", "failed", "interrupted", "outcome-unknown", "cancelled"]],
];

describe("nextLifecycle", () => {
  const cases = LEGAL.flatMap(([from, targets]) => targets.map((to) => [from, to] as const));

  it.each(cases)("allows %s -> %s", (from, to) => {
    expect(nextLifecycle(from, to)).toBe(true);
  });

  it("rejects every transition not in the table", () => {
    const legal = new Set(cases.map(([from, to]) => `${from}>${to}`));
    for (const from of RUNTIME_LIFECYCLES) {
      for (const to of RUNTIME_LIFECYCLES) {
        if (legal.has(`${from}>${to}`)) continue;
        expect(nextLifecycle(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it.each(TERMINAL)("%s allows no outgoing transition, even with restart", (from) => {
    for (const to of RUNTIME_LIFECYCLES) {
      expect(nextLifecycle(from, to)).toBe(false);
      expect(nextLifecycle(from, to, { restart: true })).toBe(false);
    }
  });

  it("never turns cancelled or outcome-unknown into completed", () => {
    expect(nextLifecycle("cancelled", "completed")).toBe(false);
    expect(nextLifecycle("outcome-unknown", "completed")).toBe(false);
  });

  const NON_TERMINAL = RUNTIME_LIFECYCLES.filter((lifecycle) => !TERMINAL.includes(lifecycle));

  it.each(NON_TERMINAL.filter((from) => from !== "reconciling"))(
    "%s reaches reconciling only with restart",
    (from) => {
      expect(nextLifecycle(from, "reconciling")).toBe(false);
      expect(nextLifecycle(from, "reconciling", {})).toBe(false);
      expect(nextLifecycle(from, "reconciling", { restart: false })).toBe(false);
      expect(nextLifecycle(from, "reconciling", { restart: true })).toBe(true);
    },
  );

  it("the restart flag does not open other targets", () => {
    expect(nextLifecycle("accepted", "completed", { restart: true })).toBe(false);
    expect(nextLifecycle("running", "ready", { restart: true })).toBe(false);
  });
});

describe("settleOperation", () => {
  it.each(TERMINAL)("stores %s as the single outcome", (outcome) => {
    expect(settleOperation(undefined, outcome)).toEqual({ ok: true, lifecycle: outcome });
    expect(settleOperation("running", outcome)).toEqual({ ok: true, lifecycle: outcome });
  });

  it.each(TERMINAL)("a second settle on %s returns already-terminal", (current) => {
    expect(settleOperation(current, "completed")).toEqual({ ok: false, reason: "already-terminal" });
    expect(settleOperation(current, current)).toEqual({ ok: false, reason: "already-terminal" });
  });

  it("settling twice keeps the first outcome", () => {
    const first = settleOperation("running", "cancelled");
    expect(first).toEqual({ ok: true, lifecycle: "cancelled" });
    if (!first.ok) throw new Error("expected first settle to succeed");
    expect(settleOperation(first.lifecycle, "completed")).toEqual({ ok: false, reason: "already-terminal" });
  });

  it.each(["accepted", "running", "cancelling", "reconciling"] as const)(
    "rejects non-terminal outcome %s",
    (outcome) => {
      expect(settleOperation("running", outcome)).toEqual({ ok: false, reason: "not-terminal-outcome" });
      expect(settleOperation(undefined, outcome)).toEqual({ ok: false, reason: "not-terminal-outcome" });
    },
  );
});

describe("combineWriterStates", () => {
  const cases: Array<[WriterState[], WriterState]> = [
    [[], "settled"],
    [["settled"], "settled"],
    [["settled", "settled"], "settled"],
    [["reconciling", "settled"], "reconciling"],
    [["cancelling", "reconciling"], "cancelling"],
    [["running", "cancelling", "reconciling"], "running"],
    [["settled", "running"], "running"],
    [["running", "unknown"], "unknown"],
    [["unknown", "running", "cancelling", "reconciling", "settled"], "unknown"],
    [["settled", "unknown"], "unknown"],
  ];

  it.each(cases)("%j -> %s", (states, expected) => {
    expect(combineWriterStates(states)).toBe(expected);
  });
});
