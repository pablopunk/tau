import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { demoRepository, PORT, tokenFile } from "../support";

const ORIGIN = { Origin: `http://127.0.0.1:${PORT}` };
const readToken = () => readFileSync(tokenFile(), "utf8").trim();
const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message" });
const doneMarks = (page: Page) => page.getByText("Done.", { exact: true });
const notificationRows = (page: Page) => page.getByTestId("subagent-notification");
const HELD = "bash sleep 30";

async function send(page: Page, text: string) {
  await messageBox(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

async function sendAndWaitForDone(page: Page, text: string, doneCount: number) {
  await send(page, text);
  await expect(doneMarks(page)).toHaveCount(doneCount, { timeout: 20_000 });
}

async function startThreadInDemoRepository(page: Page, text: string) {
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await page.getByRole("combobox", { name: "Project" }).click();
  await page.getByRole("option", { name: /demo-repo/ }).click();
  await page.getByRole("radio", { name: "Checkout" }).click();
  await send(page, text);
  await expect(page).toHaveURL(/\/c\//);
  await expect(doneMarks(page)).toHaveCount(1, { timeout: 20_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("MVP6", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(`/?token=${encodeURIComponent(readToken())}`);
    await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();
    await page.request.post("/api/projects", { data: { path: demoRepository() }, headers: ORIGIN });
    await page.reload();
  });

  test.afterAll(() => page.close());

  test("two background subagents run while the parent continues, and Stop reports stopped", async () => {
    await startThreadInDemoRepository(page, `agent ${HELD}`);
    await sendAndWaitForDone(page, "agent second job", 2);
    await expect(notificationRows(page)).toHaveCount(1, { timeout: 20_000 });
    await expect(notificationRows(page).first()).toContainText("second job finished");
    await notificationRows(page).first().getByRole("button", { name: "Stop", exact: true }).click();
    await expect(notificationRows(page)).toHaveCount(2, { timeout: 20_000 });
    await expect(notificationRows(page).last()).toContainText(`${HELD} stopped`);
  });

  test("an opened child shows type, model and status and stays read-only", async () => {
    await notificationRows(page).first().getByRole("link", { name: "Open" }).click();
    const banner = page.getByText("Subagent of");
    await expect(banner).toContainText("general-purpose");
    await expect(banner).toContainText(/faux/i);
    await expect(page.getByText("done", { exact: true }).first()).toBeVisible();
    await expect(messageBox(page)).toHaveCount(0);
  });

  test("a fork subagent starts, reports back and shows its type", async () => {
    await startThreadInDemoRepository(page, "agent-fork look around");
    await expect(notificationRows(page)).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByText("fork", { exact: true }).first()).toBeVisible();
  });

  test("list_agents renders a card with the children", async () => {
    await sendAndWaitForDone(page, "agents", 2);
    await expect(page.getByRole("button", { name: /Subagents/ }).last()).toContainText("1 total");
  });
});
