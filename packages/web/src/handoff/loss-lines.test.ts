import { emptyHandoffLosses } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { handoffLossLines, NOTHING_LOST_LINE } from "./loss-lines";

describe("handoff loss lines", () => {
  it("says nothing is left out when nothing is", () => {
    expect(handoffLossLines(emptyHandoffLosses())).toEqual([NOTHING_LOST_LINE]);
  });

  it("counts every kind of loss in plain language", () => {
    const lines = handoffLossLines({
      ...emptyHandoffLosses(),
      imagesOmitted: 3,
      thinkingBlocksOmitted: 12,
      toolResultsTruncated: 2,
      turnsDropped: 4,
      attachmentsOmitted: 1,
      partialTurnTrimmed: true,
      compactionPresent: true,
    });
    expect(lines).toEqual([
      "3 images omitted",
      "12 thinking blocks omitted",
      "2 tool results truncated",
      "1 attachment omitted",
      "4 old turns dropped",
      "Beginning of the newest turn cut",
      "Context compaction state not carried",
    ]);
  });

  it("uses the singular for one", () => {
    expect(handoffLossLines({ ...emptyHandoffLosses(), imagesOmitted: 1, turnsDropped: 1 })).toEqual([
      "1 image omitted",
      "1 old turn dropped",
    ]);
  });
});
