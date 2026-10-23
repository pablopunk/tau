import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { createRestartableServer } from "../restartable-server";
import { demoRepository, PORT, tokenFile } from "../support";

const ORIGIN = { Origin: `http://127.0.0.1:${PORT}` };
const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message" });

type TimerRow = { id: string; kind: string; source: string; firedCount: number };

async function send(page: Page, text: string) {
  await messageBox(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("MVP8 timers in the browser", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(`/?token=${encodeURIComponent(readFileSync(tokenFile(), "utf8").trim())}`);
    await page.request.put("/api/providers/openrouter/key", {
      data: { key: "sk-or-v1-faux" },
      headers: ORIGIN,
    });
    const models = (await (await page.request.get("/api/models")).json()) as {
      provider: string;
      modelId: string;
    }[];
    const [model] = models;
    await page.request.put("/api/settings/default-model", {
      data: { provider: model?.provider, modelId: model?.modelId },
      headers: ORIGIN,
    });
    await page.request.post("/api/projects", { data: { path: demoRepository() }, headers: ORIGIN });
    await page.reload();
    await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();
  });

  test.afterAll(() => page.close());

  test("the chip shows the timer, the sidebar badge shows the next wake-up, and Delete removes both", async () => {
    await page.getByRole("button", { name: "New thread", exact: true }).click();
    await page.getByRole("combobox", { name: "Project" }).click();
    await page.getByRole("option", { name: /demo-repo/ }).click();
    await page.getByRole("radio", { name: "Checkout" }).click();
    await send(page, "repeat 5m ping the build");
    await expect(page).toHaveURL(/\/c\//);
    // The header chips hide while the conversation sidebar is open (open by default).
    const closeSidebar = page.getByRole("button", { name: "Close conversation sidebar" });
    if ((await closeSidebar.count()) > 0) await closeSidebar.click();
    await expect(page.getByRole("button", { name: "1 timers" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("img", { name: /Next wake-up in/ })).toBeVisible();
    await page.getByRole("button", { name: "1 timers" }).click();
    await expect(page.getByText("every 5m")).toBeVisible();
    await page.getByRole("button", { name: "Delete timer: ping the build" }).click();
    await expect(page.getByRole("button", { name: /timers$/ })).toHaveCount(0);
    await expect(page.getByText("Timers", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("img", { name: /Next wake-up in/ })).toHaveCount(0);
  });

  test("/loop with an interval runs the prompt now and adds a loop timer", async () => {
    await send(page, "/loop 1h say hello");
    await expect(page.getByText("say hello").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "1 timers" })).toBeVisible({ timeout: 20_000 });
    await send(page, "/loop stop");
    await expect(page.getByRole("button", { name: /timers$/ })).toHaveCount(0, { timeout: 20_000 });
  });
});

const PORT_RESTART = 4396;
const FAST_TIME = { TAU_TEST_TIMER_SPEED: "600" };
const server = createRestartableServer({ port: PORT_RESTART, env: FAST_TIME });

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string) {
  const deadline = Date.now() + 40_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test.describe("MVP8 timers across a restart (test clock 600x)", () => {
  test.afterAll(async () => {
    await server.stop().catch(() => undefined);
  });

  test("/loop with a short interval fires, and a wake-up survives a server restart", async () => {
    test.setTimeout(150_000);
    await server.start();
    await server.tau("providers", "set-key", "openrouter", "sk-or-v1-faux");
    const [model] = await server.json<{ provider: string; modelId: string }[]>("models", "list");
    await server.tau("settings", "set-default-model", `${model?.provider}/${model?.modelId}`);
    const project = await server.json<{ id: string }>("projects", "add", demoRepository());
    const thread = await server.json<{ id: string }>(
      "threads",
      "start",
      "wakeup 3600 look at the deploy",
      "--project",
      project.id,
      "--request-id",
      "timers-r1",
    );
    await server.tau("threads", "wait", thread.id, "--timeout", "60");
    const listTimers = () => server.json<TimerRow[]>("timers", "list", thread.id);
    expect(await listTimers()).toMatchObject([{ kind: "wakeup", firedCount: 0 }]);

    await server.restart();
    expect(await listTimers()).toMatchObject([{ kind: "wakeup" }]);
    await waitFor(listTimers, (timers) => timers.length === 0, "the wake-up to fire and be removed");

    await server.tau("timers", "loop", thread.id, "--every", "1m", "tick");
    const fired = await waitFor(
      listTimers,
      (timers) => timers.some((timer) => timer.source === "loop" && timer.firedCount >= 2),
      "the loop to fire twice",
    );
    expect(fired).toHaveLength(1);
    await server.tau("timers", "stop-loop", thread.id);
    expect(await listTimers()).toEqual([]);
  });
});
