import { describe, expect, it } from "vitest";
import { checkGitUrl, folderNameOf, normalizeGitUrl } from "./git-url";

const rejected = (url: string, allowLocalPaths = false) =>
  expect(() => checkGitUrl(url, allowLocalPaths)).toThrow(
    expect.objectContaining({ code: "invalid_git_url" }),
  );

describe("git URL allowlist", () => {
  it.each([
    "-x",
    "--upload-pack=touch /tmp/x",
    "ext::sh -c touch% /tmp/pwned",
    "a::b",
    "https://example.com/../x",
    "https://user:pw@example.com/x.git",
    "https://user:@example.com/x.git",
    "https://-evil.com/x.git",
    "ssh://-oProxyCommand=x@host/x.git",
    "-oProxyCommand=x@host:x.git",
    "git@-host:x.git",
    "git@host:../x.git",
    "http://example.com/x.git",
    "file:///tmp/x",
    "/tmp/x",
    "relative/x",
    "https://example.com",
    "https://example.com/x y.git",
    "",
  ])("rejects %s", (url) => rejected(url));

  it("accepts local paths only when file clones are allowed", () => {
    rejected("/tmp/remote.git");
    expect(checkGitUrl("/tmp/remote.git", true)).toBe("/tmp/remote");
    rejected("/tmp/../etc/x", true);
  });

  it.each([
    ["https://GitHub.com/me/repo.git", "https://github.com/me/repo"],
    ["https://github.com/me/repo/", "https://github.com/me/repo"],
    ["https://me@github.com:8443/me/repo.git/", "https://github.com:8443/me/repo"],
    ["git@GitHub.com:me/repo.git", "ssh://git@github.com/me/repo"],
    ["ssh://git@github.com:22/me/repo.git", "ssh://git@github.com:22/me/repo"],
  ])("normalizes %s", (url, expected) => {
    expect(checkGitUrl(url, false)).toBe(expected);
    expect(normalizeGitUrl(url)).toBe(expected);
  });

  it("sees the scp form and the ssh form as the same repository", () => {
    expect(normalizeGitUrl("git@github.com:me/repo.git")).toBe(
      normalizeGitUrl("ssh://git@GITHUB.com/me/repo"),
    );
  });
});

describe("clone folder names", () => {
  it.each([
    ["https://github.com/me/repo", "repo"],
    ["https://github.com/me/.hidden", "hidden"],
    ["https://github.com/me/--odd--name", "odd--name"],
    ["https://github.com/me/we%20ird", "we-20ird"],
  ])("%s becomes %s", (url, expected) => expect(folderNameOf(url)).toBe(expected));
});
