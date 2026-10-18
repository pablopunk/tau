import { expect, test } from "@playwright/test";
import { createRestartableServer } from "../restartable-server";
import { demoRepository } from "../support";

const PORT = 4397;
const server = createRestartableServer({ port: PORT });

test.describe.configure({ mode: "serial" });

test.describe("MVP8 restart helper", () => {
  test.afterAll(async () => {
    await server.stop().catch(() => undefined);
  });

  test("the same requestId is a no-op across a server restart", async () => {
    await server.start();
    await server.tau("providers", "set-key", "openrouter", "sk-or-v1-faux");
    const [model] = await server.json<{ provider: string; modelId: string }[]>("models", "list");
    await server.tau("settings", "set-default-model", `${model?.provider}/${model?.modelId}`);
    const project = await server.json<{ id: string }>("projects", "add", demoRepository());

    const start = () =>
      server.json<{ id: string }>(
        "threads",
        "start",
        "hello",
        "--project",
        project.id,
        "--request-id",
        "mvp8-r1",
      );
    const first = await start();
    await server.tau("threads", "wait", first.id, "--timeout", "60");

    await server.restart();
    const again = await start();
    expect(again.id).toBe(first.id);
    const threads = await server.json<{ id: string }[]>("threads", "list-project", project.id);
    expect(threads.filter((thread) => thread.id === first.id)).toHaveLength(1);
    expect(threads).toHaveLength(1);
  });
});
