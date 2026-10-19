import { describe, expect, it } from "vitest";
import { pairingLink } from "./access";

describe("pairingLink", () => {
  it("never contains a single quote, so it can sit in a quoted shell argument", () => {
    const link = pairingLink("https://a.example", "ABCD2345", "Pablo's Mac", "n1");
    expect(link).not.toContain("'");
    expect(decodeURIComponent(link.split(".").slice(2).join(".").split("&")[0] ?? "")).toBe("Pablo's Mac");
  });
});
