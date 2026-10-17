import { describe, expect, it } from "vitest";
import { forkedWorkspace } from "./forked-workspace";

const merged = {
  mode: "worktree",
  path: "/w",
  branch: "pi/x",
  base: "main",
  state: "merged",
  mergedSha: "abc",
  pullRequestUrl: "https://example.com/pr/1",
} as const;

describe("forkedWorkspace", () => {
  it("copies the workspace as ready, without merge or pull request facts", () => {
    expect(forkedWorkspace(merged)).toEqual({
      ...merged,
      state: "ready",
      mergedSha: null,
      pullRequestUrl: null,
    });
  });

  it("stays undefined for a legacy thread", () => {
    expect(forkedWorkspace(undefined)).toBeUndefined();
  });
});
