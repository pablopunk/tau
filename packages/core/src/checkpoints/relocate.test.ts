import { describe, expect, it } from "vitest";
import type { CheckpointsValue } from "./checkpoint-store";
import { relocateDoc } from "./relocate";

const doc = (root: string, gitDir: string): CheckpointsValue => ({ root, gitDir, next: 3, items: [] });

describe("relocateDoc", () => {
  it("moves a checkout thread's root and git dir", () => {
    const value = doc("/src/old", "/src/old/.git");
    relocateDoc(value, "/src/old", "/src/new");
    expect(value).toMatchObject({ root: "/src/new", gitDir: "/src/new/.git", next: 3 });
  });

  it("moves only the git dir of a worktree thread", () => {
    const value = doc("/home/tau/worktrees/p/branch", "/src/old/.git");
    relocateDoc(value, "/src/old", "/src/new");
    expect(value).toMatchObject({ root: "/home/tau/worktrees/p/branch", gitDir: "/src/new/.git" });
  });

  it("leaves an empty doc and unrelated paths alone", () => {
    const empty = doc("", "");
    relocateDoc(empty, "/src/old", "/src/new");
    expect(empty).toMatchObject({ root: "", gitDir: "" });
    const other = doc("/src/older", "/src/older/.git");
    relocateDoc(other, "/src/old", "/src/new");
    expect(other).toMatchObject({ root: "/src/older", gitDir: "/src/older/.git" });
  });
});
