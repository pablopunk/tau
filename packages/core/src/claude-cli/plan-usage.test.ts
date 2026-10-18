import { describe, expect, it } from "vitest";
import { createPlanUsage } from "./plan-usage";

function usageFor() {
  let changes = 0;
  const usage = createPlanUsage({
    clock: { now: () => 42, setTimer: () => () => undefined },
    onChange: () => {
      changes += 1;
    },
  });
  return { usage, changes: () => changes };
}

describe("plan usage", () => {
  it("has none before an event", () => {
    expect(usageFor().usage.current()).toBeNull();
  });

  it("records the five hour window and announces it", () => {
    const { usage, changes } = usageFor();
    usage.record({
      status: "allowed_warning",
      unifiedWindows: { five_hour: { utilization: 0.81 } },
      resetsAt: 1_800_000,
    });
    expect(usage.current()).toEqual({
      status: "allowed_warning",
      fiveHour: 0.81,
      resetsAt: 1_800_000,
      updatedAt: 42,
    });
    expect(changes()).toBe(1);
  });

  it("keeps the last percentage and reset when an event has none", () => {
    const { usage } = usageFor();
    usage.record({ status: "allowed", rateLimitType: "five_hour", utilization: 0.4, resetsAt: 9 });
    usage.record({ status: "rejected" });
    expect(usage.current()).toMatchObject({ status: "rejected", fiveHour: 0.4, resetsAt: 9 });
  });

  it("ignores the utilization of another window", () => {
    const { usage } = usageFor();
    usage.record({ status: "allowed", rateLimitType: "seven_day", utilization: 0.9 });
    expect(usage.current()?.fiveHour).toBeNull();
  });
});
