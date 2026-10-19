import { describe, expect, it } from "vitest";
import { createSession } from "./session";

describe("session.rotate", () => {
  it("swaps the master token live: the old one stops working, the new one starts", () => {
    const session = createSession("old-token", 4000);
    expect(session.isValidToken("old-token")).toBe(true);
    session.rotate("new-token");
    expect(session.isValidToken("old-token")).toBe(false);
    expect(session.isValidToken("new-token")).toBe(true);
    expect(session.currentToken()).toBe("new-token");
    expect(session.cookieName).toBe("tau_4000");
  });
});
