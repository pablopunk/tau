import type { HandoffLosses } from "@tau/protocol";

export const NOTHING_LOST_LINE = "Nothing is left out.";

const counted = (count: number, singular: string, plural: string, rest: string): string =>
  `${count} ${count === 1 ? singular : plural} ${rest}`;

function countedLossLines(losses: HandoffLosses): string[] {
  const lines: string[] = [];
  if (losses.imagesOmitted > 0) lines.push(counted(losses.imagesOmitted, "image", "images", "omitted"));
  if (losses.thinkingBlocksOmitted > 0)
    lines.push(counted(losses.thinkingBlocksOmitted, "thinking block", "thinking blocks", "omitted"));
  if (losses.toolResultsTruncated > 0)
    lines.push(counted(losses.toolResultsTruncated, "tool result", "tool results", "truncated"));
  if (losses.attachmentsOmitted > 0)
    lines.push(counted(losses.attachmentsOmitted, "attachment", "attachments", "omitted"));
  return lines;
}

function flagLossLines(losses: HandoffLosses): string[] {
  const lines: string[] = [];
  if (losses.turnsDropped > 0) lines.push(counted(losses.turnsDropped, "old turn", "old turns", "dropped"));
  if (losses.partialTurnTrimmed) lines.push("Beginning of the newest turn cut");
  if (losses.compactionPresent) lines.push("Context compaction state not carried");
  return lines;
}

/** What the export leaves out, in plain words; one line per kind of loss. */
export function handoffLossLines(losses: HandoffLosses): string[] {
  const lines = [...countedLossLines(losses), ...flagLossLines(losses)];
  return lines.length > 0 ? lines : [NOTHING_LOST_LINE];
}
