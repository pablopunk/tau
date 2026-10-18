import { describe, expect, it } from "vitest";
import { createClaudeInput } from "./claude-input";

async function firstMessage(push: (input: ReturnType<typeof createClaudeInput>) => void) {
  const input = createClaudeInput();
  push(input);
  for await (const message of input.stream) return message;
  throw new Error("no message");
}

describe("claude input", () => {
  it("sends user images in the API base64 shape", async () => {
    const message = await firstMessage((input) =>
      input.push([
        { type: "text", text: "look" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ]),
    );
    expect(message.message.content).toEqual([
      { type: "text", text: "look" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });

  it("keeps plain text as a string", async () => {
    const message = await firstMessage((input) => input.push("hi"));
    expect(message.message.content).toBe("hi");
  });
});
