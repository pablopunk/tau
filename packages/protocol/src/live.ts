import { Type } from "typebox";
import { Value } from "typebox/value";
import { type Change, ChangeSchema } from "./entities";
import type { Op } from "./view";

const IdSchema = Type.String({ minLength: 1 });

export const ClientFrameSchema = Type.Union([
  Type.Object({ type: Type.Literal("subscribe"), conversationId: IdSchema }),
  Type.Object({ type: Type.Literal("unsubscribe"), conversationId: IdSchema }),
]);
export type ClientFrame = Type.Static<typeof ClientFrameSchema>;

const OpsSchema = Type.Unsafe<readonly Op[]>(Type.Array(Type.Array(Type.Unknown())));

/**
 * The first `ops` frame after a subscribe is `[["r", view]]`. Subscribing to an unknown conversation yields
 * `[["r", null]]` (a retired view). Ops are not validated here; `applyImmutable` checks each one.
 */
export const OpsFrameSchema = Type.Object({
  type: Type.Literal("ops"),
  conversationId: IdSchema,
  ops: OpsSchema,
});
export type OpsFrame = Type.Static<typeof OpsFrameSchema>;

export const ChangedFrameSchema = Type.Intersect([
  Type.Object({ type: Type.Literal("changed") }),
  ChangeSchema,
]);
export type ChangedFrame = Type.Static<typeof ChangedFrameSchema>;

export const ServerFrameSchema = Type.Union([OpsFrameSchema, ChangedFrameSchema]);
export type ServerFrame = Type.Static<typeof ServerFrameSchema>;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function decodeClientFrame(raw: string): ClientFrame | undefined {
  const value = parseJson(raw);
  return Value.Check(ClientFrameSchema, value) ? value : undefined;
}

export function decodeServerFrame(raw: string): ServerFrame | undefined {
  const value = parseJson(raw);
  return Value.Check(ServerFrameSchema, value) ? value : undefined;
}

export function encodeFrame(frame: ClientFrame | ServerFrame): string {
  return JSON.stringify(frame);
}

export function changedFrame(change: Change): ChangedFrame {
  return { type: "changed", ...change };
}
