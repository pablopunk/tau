import type { Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { type FauxReplies, scriptedStep } from "./faux-replies";

const replies: FauxReplies = {
  "add a test": [
    { text: "On it.", tools: [{ name: "bash", arguments: { command: "ls" } }] },
    { text: "Added." },
  ],
};
const promptOf = (message: Message) => (typeof message.content === "string" ? message.content : "");
const user = (content: string) => ({ role: "user", content, timestamp: 1 }) as Message;
const answered = { role: "assistant", content: [], timestamp: 2 } as unknown as Message;

describe("scriptedStep", () => {
  it("plays the first step for the prompt, then the next after each assistant message", () => {
    const first = scriptedStep(replies, [user("add a test")], promptOf);
    const second = scriptedStep(replies, [user("add a test"), answered], promptOf);
    expect(first?.stopReason).toBe("toolUse");
    expect(second?.stopReason).toBe("stop");
  });

  it("has nothing for an unknown prompt or a finished script", () => {
    expect(scriptedStep(replies, [user("other")], promptOf)).toBeUndefined();
    expect(scriptedStep(replies, [user("add a test"), answered, answered], promptOf)).toBeUndefined();
  });
});
