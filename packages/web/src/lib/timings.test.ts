import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearTimings, markAction, markConfirm, markLiveReflect, timingMarks, timingSpans } from "./timings";

let now = 0;

beforeEach(() => {
  clearTimings();
  now = 0;
  // `restoreMocks` resets spies between tests: re-arm the clock every time.
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

describe("timings", () => {
  it("records tap → confirm → reflect in order with client durations", () => {
    const token = markAction("send");
    now = 40;
    markConfirm(token, { submissionId: 7 });
    now = 120;
    markLiveReflect("send", { submissionId: 7 }, token);
    expect(timingMarks().map((mark) => mark.stage)).toEqual(["tap", "confirm", "reflect"]);
    expect(timingSpans()).toEqual([
      { action: "send", submissionId: 7, entryId: undefined, confirmMs: 40, reflectMs: 120 },
    ]);
  });

  it("joins the confirm to its tap by token, so concurrent actions don't mix", () => {
    const first = markAction("send");
    const second = markAction("send");
    markConfirm(second, { submissionId: 8 });
    markConfirm(first, { submissionId: 7 });
    const submissions = timingMarks()
      .filter((mark) => mark.stage === "confirm")
      .map((mark) => mark.submissionId);
    expect(submissions).toEqual([8, 7]);
  });

  it("clears the tap token on reflect", () => {
    const token = markAction("queue-send-now");
    now = 25;
    markLiveReflect("queue-send-now", { submissionId: 3 }, token);
    expect(timingSpans()).toEqual([{ action: "queue-send-now", submissionId: 3, reflectMs: 25 }]);
  });

  it("caps the ring at the last 200 marks", () => {
    for (let i = 0; i < 250; i += 1) markAction(`action-${i}`);
    expect(timingMarks()).toHaveLength(200);
    expect(timingMarks()[0]?.action).toBe("action-50");
  });

  it("emits every mark to console.debug for log scraping", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    markAction("send");
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("[timings]"), expect.anything());
  });
});
