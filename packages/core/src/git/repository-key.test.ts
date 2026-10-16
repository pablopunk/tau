import { describe, expect, it } from "vitest";
import { repositoryKey } from "./repository-key";

describe("repositoryKey", () => {
  it.each([
    "git@github.com:Me/Repo.git",
    "ssh://git@github.com/me/repo",
    "ssh://git@ssh.github.com:443/me/repo.git",
    "https://github.com/me/repo/",
    "https://github.com/ME/REPO.git",
  ])("maps %s to the GitHub key", (url) => {
    expect(repositoryKey(url)).toBe("github.com/me/repo");
  });

  it("keeps the case of other hosts", () => {
    expect(repositoryKey("https://gitlab.com/Me/Repo")).toBe("https://gitlab.com/Me/Repo");
  });

  it("keeps local paths as they are", () => {
    expect(repositoryKey("/tmp/remote.git")).toBe("/tmp/remote");
  });
});
