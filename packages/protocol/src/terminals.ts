import { type Static, Type } from "typebox";

export const TerminalInfoSchema = Type.Object({
  id: Type.String(),
  conversationId: Type.String(),
  title: Type.String(),
  status: Type.Union([Type.Literal("running"), Type.Literal("exited")]),
  exitCode: Type.Union([Type.Number(), Type.Null()]),
  createdAt: Type.Number(),
});
export type TerminalInfo = Static<typeof TerminalInfoSchema>;

export const MAX_TERMINALS_PER_THREAD = 8;
export const MAX_TERMINALS_TOTAL = 32;
export const MAX_TERMINAL_DIMENSION = 500;

const Dimension = Type.Integer({ minimum: 1, maximum: MAX_TERMINAL_DIMENSION });

export const OpenTerminalInputSchema = Type.Object({ cols: Dimension, rows: Dimension });
export type OpenTerminalInput = Static<typeof OpenTerminalInputSchema>;

export const TerminalAvailabilitySchema = Type.Object({ available: Type.Boolean() });
