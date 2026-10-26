import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { demoRepository, PORT, tokenFile, waitForConversationRunEnd } from "../support";

const ORIGIN = { Origin: `http://127.0.0.1:${PORT}` };
const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message" });

async function send(page: Page, text: string) {
  await messageBox(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

async function connectFauxProvider(page: Page) {
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
}

async function startThreadWith(page: Page, text: string) {
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await page.getByRole("combobox", { name: "Project" }).click();
  await page.getByRole("option", { name: /demo-repo/ }).click();
  await page.getByRole("radio", { name: "Checkout" }).click();
  await send(page, text);
  await expect(page).toHaveURL(/\/c\//);
}

test.describe.configure({ mode: "serial" });

test.describe("MVP8 monitor and goal in the browser", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await connectFauxProvider(page);
  });

  test.afterAll(() => page.close());

  test("a monitor shows its event rows", async () => {
    await startThreadWith(page, "monitor for i in 1 2 3; do echo tick-$i; sleep 1; done");
    await expect(page.getByTestId("monitor-event").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("monitor-event").first()).toContainText("tick-");
  });

  test("a goal shows the chip and the scripted judge's verdict rows", async () => {
    test.setTimeout(120_000);
    await startThreadWith(page, "hello");
    await waitForConversationRunEnd(page);
    await send(page, "/goal print the magic word");
    await expect(page.getByRole("button", { name: /^Goal/ }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("goal-verdict").filter({ hasText: "not met" }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("a message after Stop resumes the goal and the next run end is judged", async () => {
    test.setTimeout(120_000);
    await startThreadWith(page, "hello");
    await waitForConversationRunEnd(page);
    await send(page, "/goal bash sleep 30");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText("Goal paused: you stopped the run.")).toBeVisible({ timeout: 20_000 });
    await send(page, "bash echo goal-met");
    await expect(page.getByTestId("goal-verdict").filter({ hasText: "Goal check: met" })).toBeVisible({
      timeout: 40_000,
    });
  });
});
