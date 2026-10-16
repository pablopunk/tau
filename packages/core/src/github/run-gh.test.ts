import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { createRunGh, ghEnvironment, resolveGhPath } from "./run-gh";

const tempDir = useTempDir();

async function writeScript(body: string) {
  const path = join(await tempDir(), "gh");
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

describe("ghEnvironment", () => {
  it("disables prompts and drops host and repository overrides", () => {
    const env = ghEnvironment({ PATH: "/bin", GH_HOST: "ghe.example", GIT_DIR: "/x", GIT_WORK_TREE: "/y" });
    expect(env).toMatchObject({
      PATH: "/bin",
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
      NO_COLOR: "1",
      GH_PAGER: "cat",
    });
    expect(Object.keys(env)).not.toEqual(expect.arrayContaining(["GH_HOST"]));
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
  });
});

describe("createRunGh", () => {
  it("runs gh with the clean environment and resolves for a failing exit code", async () => {
    const path = await writeScript('echo "host=$GH_HOST prompt=$GH_PROMPT_DISABLED"; echo oops >&2; exit 3');
    const run = createRunGh(path, { GH_HOST: "ghe.example" });
    expect(await run(["anything"])).toEqual({ stdout: "host= prompt=1\n", stderr: "oops\n", exitCode: 3 });
  });

  it("rejects with ENOENT when gh cannot be started", async () => {
    const run = createRunGh(join(await tempDir(), "missing"), {});
    await expect(run([])).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects when the output is larger than the buffer", async () => {
    const path = await writeScript("head -c 9000000 /dev/zero | tr '\\0' x");
    await expect(createRunGh(path, {})([])).rejects.toBeDefined();
  });
});

describe("resolveGhPath", () => {
  it("finds the first executable gh on the PATH and ignores relative entries", async () => {
    const path = await writeScript("exit 0");
    expect(resolveGhPath({ PATH: `relative/bin:${join(path, "..")}` })).toBe(path);
    expect(resolveGhPath({ PATH: "" })).toBeUndefined();
  });
});
