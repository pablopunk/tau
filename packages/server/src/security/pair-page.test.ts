import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PAIR_PAGE, PAIR_PAGE_HEADERS, PAIR_SCRIPT_HASH } from "./pair-page";

describe("pair page", () => {
  it("allows exactly the inline script it ships: the CSP hash matches the served script text", () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(PAIR_PAGE)?.[1] ?? "";
    const hash = `sha256-${createHash("sha256").update(script).digest("base64")}`;
    expect(PAIR_SCRIPT_HASH).toBe(hash);
    expect(PAIR_PAGE_HEADERS["content-security-policy"]).toContain(`script-src '${hash}'`);
  });

  it("removes the code from the address bar before redeeming", () => {
    expect(PAIR_PAGE).toContain("history.replaceState");
    expect(PAIR_PAGE).toContain("location.replace");
  });
});
