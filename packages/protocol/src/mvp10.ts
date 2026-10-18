import { Type } from "typebox";

export const ApprovalDecisionSchema = Type.Union([
  Type.Literal("allow"),
  Type.Literal("allow_always"),
  Type.Literal("deny"),
]);
export type ApprovalDecision = Type.Static<typeof ApprovalDecisionSchema>;

export const ApprovalSchema = Type.Object({
  toolUseId: Type.String(),
  conversationId: Type.String(),
  server: Type.String(),
  tool: Type.String(),
  arguments: Type.Record(Type.String(), Type.Unknown()),
  requestedAt: Type.Number(),
});
export type Approval = Type.Static<typeof ApprovalSchema>;
