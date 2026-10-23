import { describe, expect, it } from "vitest";
import { isCompleteTimeline, type Marks, stageNamesOf, timelineOf } from "./stages";

const NATIVE_MARKS: Marks = {
  submit: 0,
  receipt: 3,
  launch: 500,
  firstEvent: 700,
  firstText: 730,
  terminal: 1200,
};
const PI_MARKS: Marks = { submit: 0, receipt: 250, firstText: 255, terminal: 256 };

describe("timelineOf", () => {
  it("derives every native stage from consecutive local marks", () => {
    const timeline = timelineOf("claude-code", NATIVE_MARKS);

    expect(timeline.durationsMs).toEqual({
      submitToReceipt: 3,
      preparation: 497,
      launchToFirstEvent: 200,
      firstAssistantText: 30,
      terminalOutcome: 470,
      total: 1200,
    });
    expect(isCompleteTimeline(timeline)).toBe(true);
  });

  it("derives the three Pi stages and the total", () => {
    const timeline = timelineOf("pi", PI_MARKS);

    expect(Object.keys(timeline.durationsMs)).toEqual([
      "submitToReceipt",
      "firstAssistantText",
      "terminalOutcome",
      "total",
    ]);
    expect(timeline.durationsMs.firstAssistantText).toBe(5);
  });

  it("lists a stage whose mark was never recorded as missing, never as zero or null", () => {
    const { firstEvent: _dropped, ...withoutFirstEvent } = NATIVE_MARKS;

    const timeline = timelineOf("claude-code", withoutFirstEvent);

    expect(timeline.missing).toEqual(["launchToFirstEvent", "firstAssistantText"]);
    expect(timeline.durationsMs).not.toHaveProperty("launchToFirstEvent");
    expect(isCompleteTimeline(timeline)).toBe(false);
  });

  it("flags marks that run backwards as invalid", () => {
    const timeline = timelineOf("claude-code", { ...NATIVE_MARKS, launch: 1 });

    expect(timeline.invalid).toEqual(["preparation"]);
    expect(isCompleteTimeline(timeline)).toBe(false);
  });

  it("flags a non-finite mark as invalid", () => {
    expect(timelineOf("pi", { ...PI_MARKS, terminal: Number.NaN }).invalid).toContain("terminalOutcome");
  });

  it("needs the total even when every stage is present", () => {
    expect(stageNamesOf("pi").at(-1)).toBe("total");
    expect(timelineOf("pi", {}).missing).toEqual(stageNamesOf("pi"));
  });
});
