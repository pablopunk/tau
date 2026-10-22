import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyWorkspace } from "../harness/conversation-index";
import { setUp } from "./workspace-test-support";
import { sandboxRootOf } from "./worktree-facts";

describe("sandboxRootOf", () => {
  it("resolves a worktree thread to its worktree", async () => {
    const { startThread } = await setUp();
    const thread = await startThread();
    expect(await sandboxRootOf(thread)).toBe(await realpath(thread.workspace.path));
  });

  it("resolves a checkout thread to the main checkout", async () => {
    const { add, projectPath } = await setUp();
    const thread = add(legacyWorkspace(projectPath));
    expect(await sandboxRootOf(thread)).toBe(await realpath(projectPath));
  });

  it("denies a removed thread", async () => {
    const { startThread, service } = await setUp();
    const thread = await startThread();
    const removed = await service.remove(thread.id, false);
    expect(removed.workspace.state).toBe("removed");
    expect(await sandboxRootOf(removed)).toBeUndefined();
  });

  it("denies when the worktree is gone from disk", async () => {
    const { add } = await setUp();
    const thread = add({
      mode: "worktree",
      path: join("no-such-worktree", "sub"),
      branch: "pi/dead",
      base: "main",
      state: "ready",
      mergedSha: null,
      pullRequestUrl: null,
    });
    expect(await sandboxRootOf(thread)).toBeUndefined();
  });

  it("denies when the checkout path is missing", async () => {
    const { add } = await setUp();
    const thread = add(legacyWorkspace(join("no-such-checkout")));
    expect(await sandboxRootOf(thread)).toBeUndefined();
  });
});
