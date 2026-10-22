import { afterEach, describe, expect, it, vi } from "vitest";
import { logSendNowBreakdown, logStage, STAGE, TIMING_SOURCE } from "./timing";

const lines: string[] = [];
const info = vi.spyOn(console, "info").mockImplementation((line: string) => {
  lines.push(String(line));
});

afterEach(() => {
  lines.length = 0;
  info.mockClear();
});

describe("logStage", () => {
  it("emits one greppable single-line JSON object with stable keys", () => {
    logStage({
      action: "send",
      stage: STAGE.admission,
      serverMs: 3,
      conversationId: "c1",
      requestId: "r1",
      submissionId: "s1",
    });
    expect(lines).toHaveLength(1);
    const line = lines[0] as string;
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(parsed.source).toBe(TIMING_SOURCE);
    expect(parsed.action).toBe("send");
    expect(parsed.stage).toBe("admission");
    expect(parsed.serverMs).toBe(3);
    expect(parsed.conversationId).toBe("c1");
    expect(parsed.requestId).toBe("r1");
    expect(parsed.submissionId).toBe("s1");
    expect(typeof parsed.t).toBe("number");
  });

  it("stays greppable by correlation id", () => {
    logStage({ action: "send", stage: STAGE.runStart, submissionId: "s-42" });
    expect(lines[0]).toContain("s-42");
  });
});

describe("logSendNowBreakdown", () => {
  it("emits the gate-wait/abort/admit split with shared correlation", () => {
    logSendNowBreakdown({
      conversationId: "c1",
      requestId: "r1",
      submissionId: "s1",
      gateWaitMs: 4,
      abortMs: 12,
      admitMs: 2,
    });
    expect(lines).toHaveLength(3);
    const parsed = lines.map((line) => JSON.parse(line));
    expect(parsed.map((p) => p.stage)).toEqual(["gate-wait", "abort", "admit"]);
    for (const p of parsed) {
      expect(p.action).toBe("send-now");
      expect(p.conversationId).toBe("c1");
      expect(p.submissionId).toBe("s1");
    }
    expect(parsed.map((p) => p.serverMs)).toEqual([4, 12, 2]);
  });
});
