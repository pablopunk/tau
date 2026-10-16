import { describe, expect, it } from "vitest";
import { diffStats, parseDiff } from "./diff-lines";

describe("parseDiff", () => {
  it("classifies lines of the tool's numbered diff", () => {
    expect(parseDiff("-1 hello world\n+1 goodbye world")).toEqual([
      { kind: "remove", text: "-1 hello world" },
      { kind: "add", text: "+1 goodbye world" },
    ]);
  });

  it("drops unified patch file headers and keeps hunks and context", () => {
    const lines = parseDiff("--- a.txt\n+++ a.txt\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n");
    expect(lines.map((line) => line.kind)).toEqual(["hunk", "context", "remove", "add"]);
  });

  it("counts added and removed lines", () => {
    expect(diffStats(parseDiff("+a\n+b\n-c\n d"))).toEqual({ added: 2, removed: 1 });
  });
});
