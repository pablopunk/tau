import { describe, expect, it } from "vitest";
import { credentialHelperArgs } from "./credential-config";

const GH = "/opt/homebrew/bin/gh";

describe("credentialHelperArgs", () => {
  it("clears the helper then sets gh's for https github.com when connected", () => {
    expect(credentialHelperArgs("https://github.com/me/repo.git", GH, true)).toEqual([
      "-c",
      "credential.https://github.com.helper=",
      "-c",
      `credential.https://github.com.helper=!'${GH}' auth git-credential`,
    ]);
  });

  it("quotes a gh path with a single quote", () => {
    const args = credentialHelperArgs("https://github.com/me/repo", "/o'dd/gh", true);
    expect(args[3]).toBe("credential.https://github.com.helper=!'/o'\\''dd/gh' auth git-credential");
  });

  it.each([
    ["ssh github", "git@github.com:me/repo.git", GH, true],
    ["other host", "https://gitlab.com/me/repo.git", GH, true],
    ["local path", "/tmp/repo.git", GH, true],
    ["not connected", "https://github.com/me/repo.git", GH, false],
    ["no gh path", "https://github.com/me/repo.git", undefined, true],
  ])("adds nothing for %s", (_name, url, ghPath, connected) => {
    expect(credentialHelperArgs(url, ghPath, connected)).toEqual([]);
  });
});
