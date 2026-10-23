import { describe, expect, it } from "vitest";
import { buildSeatbeltProfile, escapeSeatbelt, privateAlias } from "./profile";

describe("escapeSeatbelt", () => {
  it("escapes backslashes and double quotes", () => {
    expect(escapeSeatbelt('a"b\\c')).toBe('a\\"b\\\\c');
  });
});

describe("privateAlias", () => {
  it("maps /tmp spellings to /private/tmp", () => {
    expect(privateAlias("/tmp")).toBe("/private/tmp");
    expect(privateAlias("/tmp/work-x")).toBe("/private/tmp/work-x");
  });

  it("leaves other roots alone", () => {
    expect(privateAlias("/Users/a/wt")).toBeUndefined();
    expect(privateAlias("/private/tmp/x")).toBeUndefined();
  });
});

describe("buildSeatbeltProfile", () => {
  it("is golden for a plain root", () => {
    expect(buildSeatbeltProfile({ root: "/wt" })).toBe(
      `(version 1)\n(allow file-write* (subpath "/wt") (literal "/dev/null"))\n(deny file-write*)\n(allow default)\n`,
    );
  });

  it("allows reads by default and denies writes outside first", () => {
    const profile = buildSeatbeltProfile({ root: "/wt" });
    expect(profile.indexOf("(allow file-write*")).toBeLessThan(profile.indexOf("(deny file-write*)"));
    expect(profile).toContain("(allow default)");
  });

  it("covers both /tmp spellings", () => {
    const profile = buildSeatbeltProfile({ root: "/tmp/work-x" });
    expect(profile).toContain(`(subpath "/tmp/work-x")`);
    expect(profile).toContain(`(subpath "/private/tmp/work-x")`);
  });

  it("escapes spaces, quotes and backslashes in roots", () => {
    const root = '/wt/my work\\"odd';
    const profile = buildSeatbeltProfile({ root });
    expect(profile).toContain(`(subpath "${escapeSeatbelt(root)}")`);
    expect(profile).not.toContain(root);
  });

  it("adds the git allowlist as extra writable subpaths", () => {
    const profile = buildSeatbeltProfile({
      root: "/wt",
      extraWritePaths: ["/main/.git/objects", "/main/.git/refs/heads/feat"],
    });
    expect(profile).toContain(`(subpath "/main/.git/objects")`);
    expect(profile).toContain(`(subpath "/main/.git/refs/heads/feat")`);
  });

  it("never carries a blanket deny-signal: children must signal children", () => {
    const profile = buildSeatbeltProfile({ root: "/wt" });
    expect(profile).not.toContain("deny signal");
    expect(profile).not.toMatch(/\(deny\s+signal/);
  });
});
