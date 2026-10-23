import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, expect, test } from "@playwright/test";
import { createCoreWith, defaultCoreDependencies } from "../../packages/core/src/create-core";
import type { NativeQueryFn } from "../../packages/core/src/runtimes/native/controller";
import { NO_UPDATE_OPTIONS } from "../../packages/core/src/test-support/update-options";
import type { Core } from "../../packages/protocol/src/core";
import { createServer, type RunningServer } from "../../packages/server/src/create-server";

const REPLY = "NATIVE_INJECTED_BROWSER_REPLY";

test("compiled web starts and opens a selected Claude CLI model through the native executor", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), "tau-native-injected-browser-"));
  let core: Core | undefined;
  let server: RunningServer | undefined;
  let context: BrowserContext | undefined;
  const nativeOptions: Record<string, unknown>[] = [];
  let run = 0;
  const nativeQuery: NativeQueryFn = ({ options }) => {
    nativeOptions.push(options);
    const sessionId = `native-injected-session-${++run}`;
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: sessionId, uuid: `${sessionId}-init` };
      yield {
        type: "assistant",
        session_id: sessionId,
        uuid: `${sessionId}-assistant`,
        message: {
          id: `${sessionId}-message`,
          content: [{ type: "text", text: REPLY }],
        },
      };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "completed",
        session_id: sessionId,
        uuid: `${sessionId}-result`,
      };
    })();
  };

  try {
    const env: NodeJS.ProcessEnv = { ...process.env, TAU_FAKE_CLAUDE_CLI: "1" };
    core = await createCoreWith(
      { home: join(root, "home"), faux: true, ...NO_UPDATE_OPTIONS },
      {
        ...defaultCoreDependencies(),
        env,
        claudeCodeInstalled: async () => true,
        nativeQuery,
      },
    );
    await core.providers.setApiKey("openrouter", "sk-native-injected-not-a-credential");
    await core.providers.acknowledgeClaudeCli();

    const models = await core.models.list();
    const fallback = models.find((model) => model.provider === "faux");
    const nativeModel = models.find((model) => model.provider === "claude-cli" && model.modelId === "haiku");
    if (!fallback || !nativeModel) throw new Error("required fake and Claude CLI models were not listed");
    await core.settings.setDefaultModel({ provider: fallback.provider, modelId: fallback.modelId });

    const projectPath = join(root, "project");
    await mkdir(projectPath);
    const project = await core.projects.add({ path: projectPath });
    server = await createServer({
      core,
      staticDir: resolve(import.meta.dirname, "../../packages/web/dist"),
      port: 0,
      token: randomBytes(32).toString("hex"),
    });

    context = await browser.newContext();
    const origin = server.origin;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    await page.goto(server.url);
    await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible({ timeout: 30_000 });
    await page.goto(`${server.origin}/new?project=${encodeURIComponent(project.id)}`);
    await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();

    const picker = page.getByRole("combobox", { name: "Model" });
    await picker.click();
    await page.getByRole("option", { name: /Haiku 5\.5 \(haiku\)/ }).click();
    await expect(picker).toContainText("Claude CLI · Haiku 5.5");
    await expect(page.getByRole("combobox", { name: "Thinking level" })).toHaveCount(0);

    await page.getByRole("textbox", { name: "Message" }).fill("start the injected native thread");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(REPLY, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/p/${encodeURIComponent(project.id)}/c/`));

    const [thread] = await core.conversations.list(project.id);
    expect(thread).toMatchObject({
      executor: "claude-code",
      model: { provider: nativeModel.provider, modelId: nativeModel.modelId },
    });
    expect(nativeOptions).toHaveLength(1);
    expect(nativeOptions[0]).toMatchObject({ model: nativeModel.modelId });
  } finally {
    try {
      await context?.close();
    } finally {
      try {
        await server?.close();
      } finally {
        try {
          await core?.close();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    }
  }
});
