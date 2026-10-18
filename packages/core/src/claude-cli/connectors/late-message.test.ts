import { describe, expect, it } from "vitest";
import { lateConnectorsMessage } from "./late-message";

describe("lateConnectorsMessage", () => {
  it("names every late server", () => {
    expect(lateConnectorsMessage(["claude.ai Linear: pending", "claude.ai Slack: failed"])).toBe(
      "Connectors late to start: claude.ai Linear: pending; claude.ai Slack: failed",
    );
  });
});
