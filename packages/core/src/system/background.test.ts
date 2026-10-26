import { describe, expect, it } from "vitest";
import { prefixFor, probeChrt, withPrefix } from "./background";

describe("prefixFor", () => {
  it("uses taskpolicy -b on macOS", () => {
    expect(prefixFor("macos", { taskpolicy: "/usr/sbin/taskpolicy" })).toEqual([
      "/usr/sbin/taskpolicy",
      "-b",
    ]);
    expect(prefixFor("macos", {})).toEqual([]);
  });

  it("prefers chrt over nice on Linux", () => {
    expect(prefixFor("linux", { chrt: "/usr/bin/chrt", nice: "/usr/bin/nice" })).toEqual([
      "/usr/bin/chrt",
      "-i",
      "0",
    ]);
    expect(prefixFor("linux", { nice: "/usr/bin/nice" })).toEqual(["/usr/bin/nice", "-n", "19"]);
    expect(prefixFor("linux", {})).toEqual([]);
  });

  it("falls back to nice when chrt is present but unusable", () => {
    expect(prefixFor("linux", { chrt: "/usr/bin/chrt", nice: "/usr/bin/nice" }, false)).toEqual([
      "/usr/bin/nice",
      "-n",
      "19",
    ]);
    expect(prefixFor("linux", { chrt: "/usr/bin/chrt" }, false)).toEqual([]);
  });

  it("the chrt probe fails closed on a missing binary", () => {
    expect(probeChrt("/tmp/definitely-missing-xyz/chrt", "/bin/sh")).toBe(false);
  });

  it("is empty off-platform", () => {
    expect(prefixFor("other", { nice: "/usr/bin/nice" })).toEqual([]);
  });
});

describe("withPrefix", () => {
  const prefix = ["/usr/bin/nice", "-n", "19"];

  it("prepends the prefix to a bare command on the PATH", () => {
    expect(withPrefix(prefix, "git", ["status"], "/usr/bin:/bin")).toEqual({
      file: "/usr/bin/nice",
      args: ["-n", "19", "git", "status"],
    });
  });

  it("leaves a missing bare command alone so ENOENT still surfaces", () => {
    expect(withPrefix(prefix, "definitely-not-a-binary-xyz", ["x"], "/tmp/empty-path-xyz")).toEqual({
      file: "definitely-not-a-binary-xyz",
      args: ["x"],
    });
  });

  it("leaves a missing absolute path alone", () => {
    expect(withPrefix(prefix, "/tmp/definitely-missing-xyz/gh", ["x"])).toEqual({
      file: "/tmp/definitely-missing-xyz/gh",
      args: ["x"],
    });
  });

  it("prefixes a present absolute path", () => {
    expect(withPrefix(prefix, "/bin/sh", ["-c", ":"])).toEqual({
      file: "/usr/bin/nice",
      args: ["-n", "19", "/bin/sh", "-c", ":"],
    });
  });

  it("an explicit PATH does not leak the fallback directories", () => {
    expect(withPrefix(prefix, "sh", [], "/bin")).toEqual({
      file: "/usr/bin/nice",
      args: ["-n", "19", "sh"],
    });
    expect(withPrefix(prefix, "sh", [], "/tmp/definitely-empty-xyz")).toEqual({
      file: "sh",
      args: [],
    });
  });

  it("is a no-op when the prefix is empty", () => {
    expect(withPrefix([], "git", ["status"])).toEqual({ file: "git", args: ["status"] });
  });
});
