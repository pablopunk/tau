import { type Static, Type } from "typebox";
import { AppError } from "./errors";

export const HANDOFF_INSTRUCTION_MAX_LENGTH = 4000;
export const HANDOFF_PREVIEW_CHARS = 2000;

const Count = Type.Integer({ minimum: 0 });

/** What the deterministic export leaves out or shortens; counted over the turns that were kept. */
export const HandoffLossesSchema = Type.Object({
  imagesOmitted: Count,
  thinkingBlocksOmitted: Count,
  toolResultsTruncated: Count,
  turnsDropped: Count,
  /** The thread was compacted: older detail reaches the new thread only as Pi's summary. */
  compactionPresent: Type.Boolean(),
  attachmentsOmitted: Count,
  /** The newest turn alone passed the size budget, so its beginning was cut. */
  partialTurnTrimmed: Type.Boolean(),
  exportedChars: Count,
});
export type HandoffLosses = Static<typeof HandoffLossesSchema>;

export const HandoffPreviewSchema = Type.Object({
  canHandoff: Type.Boolean(),
  reason: Type.Optional(Type.String()),
  losses: HandoffLossesSchema,
  /** The first `HANDOFF_PREVIEW_CHARS` characters of the export. */
  preview: Type.String({ maxLength: HANDOFF_PREVIEW_CHARS }),
});
export type HandoffPreview = Static<typeof HandoffPreviewSchema>;

export const HandoffInputSchema = Type.Object({
  /** One handoff per `requestId`: a repeat returns the same new thread. */
  requestId: Type.String({ minLength: 1 }),
  instruction: Type.Optional(Type.String({ maxLength: HANDOFF_INSTRUCTION_MAX_LENGTH })),
});
export type HandoffInput = Static<typeof HandoffInputSchema>;

export const emptyHandoffLosses = (): HandoffLosses => ({
  imagesOmitted: 0,
  thinkingBlocksOmitted: 0,
  toolResultsTruncated: 0,
  turnsDropped: 0,
  compactionPresent: false,
  attachmentsOmitted: 0,
  partialTurnTrimmed: false,
  exportedChars: 0,
});

const yesNo = (value: boolean): string => (value ? "yes" : "no");

/** One fixed line, so the CLI and the first message of the new thread say the same thing. */
export function describeHandoffLosses(losses: HandoffLosses): string {
  return [
    `images omitted ${losses.imagesOmitted}`,
    `thinking blocks omitted ${losses.thinkingBlocksOmitted}`,
    `tool results truncated ${losses.toolResultsTruncated}`,
    `turns dropped ${losses.turnsDropped}`,
    `attachments omitted ${losses.attachmentsOmitted}`,
    `compacted history summarized ${yesNo(losses.compactionPresent)}`,
    `newest turn trimmed ${yesNo(losses.partialTurnTrimmed)}`,
  ].join(", ");
}

/** The trimmed instruction, or `undefined` for none. Rejects `invalid_request` for a blank requestId or a long instruction. */
export function validatedHandoffInstruction(input: HandoffInput): string | undefined {
  if (input.requestId.trim() === "") throw new AppError("invalid_request", "A handoff needs a requestId.");
  const instruction = input.instruction?.trim();
  if ((instruction?.length ?? 0) > HANDOFF_INSTRUCTION_MAX_LENGTH) {
    throw new AppError(
      "invalid_request",
      `The instruction can have at most ${HANDOFF_INSTRUCTION_MAX_LENGTH} characters.`,
    );
  }
  return instruction === "" ? undefined : instruction;
}
