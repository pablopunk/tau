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

  it("fails when the script changes without the hash", () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(PAIR_PAGE)?.[1] ?? "";
    const tampered = `${script}\n;fetch("/evil");`;
    const hash = `sha256-${createHash("sha256").update(tampered).digest("base64")}`;
    expect(hash).not.toBe(PAIR_SCRIPT_HASH);
  });

  it("ships the exact lock-down policy and no external resources", () => {
    const csp = PAIR_PAGE_HEADERS["content-security-policy"];
    for (const part of [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(csp).toContain(part);
    }
    expect(PAIR_PAGE).not.toMatch(/(src|href)=["']?https?:/);
  });

  it("labels both fields and reads the fragment as <code>.<name>", () => {
    expect(PAIR_PAGE).toContain('for="code"');
    expect(PAIR_PAGE).toContain('for="name"');
    expect(PAIR_PAGE).toContain("prefers-color-scheme:dark");
    expect(PAIR_PAGE).toContain('.split(".")');
  });
});
