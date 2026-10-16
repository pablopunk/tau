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
    },
    dispose: () => core.close(),
  };
});
