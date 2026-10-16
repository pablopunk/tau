import { runCoreContract } from "./contract/index";
import { createFakeCore } from "./index";

const SPEED = 20;

runCoreContract("testkit fake", async () => {
  const fs: Record<string, "directory" | "file"> = { "/fake/notes.txt": "file" };
  const core = createFakeCore({ speed: SPEED, fs });
  return {
    core,
    paths: {
      directory: async (name) => {
        fs[`/fake/${name}`] = "directory";
        return `/fake/${name}`;
      },
      file: async () => "/fake/notes.txt",
      missing: () => "/fake/missing",
      cloneUrl: async () => "https://example.com/demo/ok.git",
      failingCloneUrl: () => "https://127.0.0.1:1/fail.git",
    },
    dispose: () => core.close(),
  };
});
