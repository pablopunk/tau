import type { Core } from "@tau/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoreWith, defaultCoreDependencies } from "./create-core";
import type { NativeQueryFn } from "./runtimes/native/controller";
import { homeIn, useTempDir } from "./test-support/temp-dir";
import { NO_UPDATE_OPTIONS } from "./test-support/update-options";
import { createWorkspaceService, type WorkspaceDeps } from "./workspaces/workspace-service";

vi.mock("./workspaces/workspace-service", async (importOriginal) => {
  const original = await importOriginal<typeof import("./workspaces/workspace-service")>();
  return { ...original, createWorkspaceService: vi.fn(original.createWorkspaceService) };
});

const tempDir = useTempDir();
const cores: Core[] = [];
const idleQuery: NativeQueryFn = () => (async function* () {})();

afterEach(async () => {
  await Promise.all(cores.splice(0).map((core) => core.close()));
  vi.mocked(createWorkspaceService).mockClear();
});

async function workspaceDepsFor(env: Record<string, string>): Promise<WorkspaceDeps> {
  const core = await createCoreWith(
    { home: homeIn(await tempDir()), faux: true, ...NO_UPDATE_OPTIONS },
    { ...defaultCoreDependencies(), env, nativeQuery: idleQuery },
  );
  cores.push(core);
  const [deps] = vi.mocked(createWorkspaceService).mock.calls.at(-1) ?? [];
  if (!deps) throw new Error("the workspace service was not created");
  return deps;
}

describe("createCore workspace writer port wiring", () => {
  it("passes no writer port while the native flag is off", async () => {
    const deps = await workspaceDepsFor({});
    expect("writerStateOf" in deps).toBe(false);
  });

  it("passes a writer port while the native flag is on, and it answers undefined for a Pi thread", async () => {
    const deps = await workspaceDepsFor({ TAU_EXPERIMENTAL_NATIVE_CLAUDE: "1" });
    expect(deps.writerStateOf).toBeTypeOf("function");
    expect(await deps.writerStateOf?.({ id: "999999" } as never)).toBeUndefined();
  });
});
