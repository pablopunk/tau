import { describe, expect, it, vi } from "vitest";
import { createDecisionsStatus, isDecisionBackend } from "./decisions-status";

describe("decisions status", () => {
  it("answers only the decision backends and never blocks list()", () => {
    const check = vi.fn(async () => "ready" as const);
    const status = createDecisionsStatus({ check, now: () => 0 });
    expect(isDecisionBackend("typesafe")).toBe(true);
    expect(isDecisionBackend("openai")).toBe(true);
    expect(isDecisionBackend("openrouter")).toBe(false);
    expect(status.decisionsFor("openrouter")).toBeUndefined();
    // Unknown by default; the probe runs in the background.
    expect(status.decisionsFor("typesafe")).toBe("unknown");
  });

  it("reports checking while a probe is in flight and caches the result", async () => {
    let resolveProbe: (value: "ready") => void = () => undefined;
    const gate = new Promise<"ready">((resolve) => {
      resolveProbe = resolve;
    });
    let now = 0;
    const status = createDecisionsStatus({ check: () => gate, now: () => now });
    expect(status.decisionsFor("openai")).toBe("unknown");
    expect(status.decisionsFor("openai")).toBe("checking");
    resolveProbe("ready");
    await gate;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(status.decisionsFor("openai")).toBe("ready");
    now = 25 * 60 * 60 * 1000;
    expect(status.decisionsFor("openai")).toBe("ready");
  });
});
