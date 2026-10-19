import { Type } from "typebox";
import {
  CloseFrameSchema,
  CreditFrameSchema,
  OpenFrameSchema,
  PingFrameSchema,
  PongFrameSchema,
  RequestFrameSchema,
  ResponseFrameSchema,
} from "./node-link";

/**
 * @deprecated TRANSITIONAL (MVP13 Step 1 foundation). The 0.1.x hub-only link spoke an unauthenticated `hello`
 * with a `threadCount`. The old one-way link code (`server/src/nodes/link-session.ts`, `cli/src/nodes/link-*.ts`)
 * still speaks it so the tree stays green until owners B and D replace it with `createLinkPeer`; they delete this
 * file with it. It is NOT part of `LinkFrameSchema` or of `linkProtocol`.
 */
export const LegacyHelloFrameSchema = Type.Object({
  type: Type.Literal("hello"),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  os: Type.String({ maxLength: 120 }),
  tauVersion: Type.String({ maxLength: 60 }),
  protocolVersion: Type.String({ maxLength: 80 }),
  threadCount: Type.Number(),
});
export type LegacyNodeHello = Omit<Type.Static<typeof LegacyHelloFrameSchema>, "type">;

export const LegacyLinkFrameSchema = Type.Union([
  LegacyHelloFrameSchema,
  RequestFrameSchema,
  ResponseFrameSchema,
  OpenFrameSchema,
  CloseFrameSchema,
  CreditFrameSchema,
  PingFrameSchema,
  PongFrameSchema,
]);
export type LegacyLinkFrame = Type.Static<typeof LegacyLinkFrameSchema>;
