import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { COMMAND_EXCLUSIONS } from "./commands";
import { ConversationSummarySchema } from "./entities";
import {
  describeHandoffLosses,
  emptyHandoffLosses,
  HANDOFF_INSTRUCTION_MAX_LENGTH,
  HANDOFF_PREVIEW_CHARS,
  HandoffInputSchema,
  HandoffLossesSchema,
  HandoffPreviewSchema,
  validatedHandoffInstruction,
} from "./handoff";
import { fillPath, routes } from "./rest";

describe("handoff schemas", () => {
  it("accepts empty losses and a preview that cannot hand off with a reason", () => {
    const preview = { canHandoff: false, reason: "busy", losses: emptyHandoffLosses(), preview: "" };

    expect(Value.Check(HandoffLossesSchema, emptyHandoffLosses())).toBe(true);
    expect(Value.Check(HandoffPreviewSchema, preview)).toBe(true);
  });

  it("rejects negative or fractional counts and a preview longer than the cap", () => {
    const losses = emptyHandoffLosses();

    expect(Value.Check(HandoffLossesSchema, { ...losses, imagesOmitted: -1 })).toBe(false);
    expect(Value.Check(HandoffLossesSchema, { ...losses, turnsDropped: 1.5 })).toBe(false);
    expect(
      Value.Check(HandoffPreviewSchema, {
        canHandoff: true,
        losses,
        preview: "x".repeat(HANDOFF_PREVIEW_CHARS + 1),
      }),
    ).toBe(false);
  });

  it("needs a requestId and caps the instruction", () => {
    expect(Value.Check(HandoffInputSchema, { requestId: "r1" })).toBe(true);
    expect(Value.Check(HandoffInputSchema, { requestId: "r1", instruction: "fix it" })).toBe(true);
    expect(Value.Check(HandoffInputSchema, {})).toBe(false);
    expect(Value.Check(HandoffInputSchema, { requestId: "" })).toBe(false);
    expect(
      Value.Check(HandoffInputSchema, {
        requestId: "r1",
        instruction: "x".repeat(HANDOFF_INSTRUCTION_MAX_LENGTH + 1),
      }),
    ).toBe(false);
  });

  it("describes the losses on one fixed line", () => {
    const losses = {
      ...emptyHandoffLosses(),
      imagesOmitted: 2,
      toolResultsTruncated: 3,
      compactionPresent: true,
    };

    expect(describeHandoffLosses(losses)).toBe(
      "images omitted 2, thinking blocks omitted 0, tool results truncated 3, turns dropped 0, attachments omitted 0, compacted history summarized yes, newest turn trimmed no",
    );
  });
});

describe("validatedHandoffInstruction", () => {
  it("trims the instruction and treats a blank one as none", () => {
    expect(validatedHandoffInstruction({ requestId: "r", instruction: "  do it  " })).toBe("do it");
    expect(validatedHandoffInstruction({ requestId: "r", instruction: "   " })).toBeUndefined();
    expect(validatedHandoffInstruction({ requestId: "r" })).toBeUndefined();
  });

  it("rejects a blank requestId and a too long instruction with invalid_request", () => {
    expect(() => validatedHandoffInstruction({ requestId: " " })).toThrow(
      expect.objectContaining({ code: "invalid_request" }),
    );
    expect(() =>
      validatedHandoffInstruction({
        requestId: "r",
        instruction: "x".repeat(HANDOFF_INSTRUCTION_MAX_LENGTH + 1),
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_request" }));
  });
});

describe("handoff routes", () => {
  it("previews with a GET and hands off with a POST that answers a ConversationSummary", () => {
    expect(routes.getHandoffPreview).toMatchObject({ method: "GET", status: 200 });
    expect(fillPath(routes.getHandoffPreview.path, { id: "7" })).toBe("/api/conversations/7/handoff-preview");
    expect(routes.handoffConversation).toMatchObject({ method: "POST", status: 201 });
    expect(fillPath(routes.handoffConversation.path, { id: "7" })).toBe("/api/conversations/7/handoff");
    expect(routes.handoffConversation.response).toBe(ConversationSummarySchema);
    expect(routes.handoffConversation.body).toBe(HandoffInputSchema);
  });

  it("is kept out of the generic CLI table because it needs a dry-run default", () => {
    expect(Object.keys(COMMAND_EXCLUSIONS)).toEqual(
      expect.arrayContaining(["getHandoffPreview", "handoffConversation"]),
    );
  });
});
