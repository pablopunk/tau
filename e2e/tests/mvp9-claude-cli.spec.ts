import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { PORT, tokenFile } from "../support";

const ORIGIN = { Origin: `http://127.0.0.1:${PORT}` };
const FAKE_REPLY = "Fake Claude reply.";
const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message" });
const conversation = (page: Page) => page.getByTestId("conversation");
const conversationIdOf = (page: Page) => new URL(page.url()).pathname.split("/").pop() ?? "";

async function send(page: Page, text: string) {
  await messageBox(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

async function connectFauxProvider(page: Page) {
  await page.request.put("/api/providers/openrouter/key", {
    data: { key: "sk-or-v1-faux" },
    headers: ORIGIN,
  });
  const [model] = (await (await page.request.get("/api/models")).json()) as {
    provider: string;
    modelId: string;
  }[];
  await page.request.put("/api/settings/default-model", {
    data: { provider: model?.provider, modelId: model?.modelId },
    headers: ORIGIN,
  });
}

async function acceptTheNotice(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Providers" })
    .click();
  const row = page.getByRole("listitem", { name: "Claude CLI" });
  await expect(row).toContainText("Runs the Claude Agent SDK under your own Claude login, for your own use.");
  await row.getByRole("button", { name: "I understand for Claude CLI" }).click();
  await expect(row).toContainText("Connected via claude CLI");
  await page.keyboard.press("Escape");
}

async function pickHaiku(page: Page) {
  const picker = page.getByRole("combobox", { name: "Model" });
  await picker.click();
  await page.getByRole("option", { name: /Haiku 5\.5 \(haiku\)/ }).click();
  await expect(picker).toContainText("Claude CLI · Haiku 5.5");
}

test.describe.configure({ mode: "serial" });

test.describe("MVP9 Claude CLI provider with the fake Agent SDK", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(`/?token=${encodeURIComponent(readFileSync(tokenFile(), "utf8").trim())}`);
    await connectFauxProvider(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();
  });

  test.afterAll(() => page.close());

  test("accept the notice and pick Claude CLI Haiku", async () => {
    await acceptTheNotice(page);
    await page.getByRole("button", { name: "New thread", exact: true }).click();
    await pickHaiku(page);
  });

  test("a tool card appears, Stop ends it, a new message gets a reply", async () => {
    await send(page, "bash sleep 30");
    await expect(page).toHaveURL(/\/c\//);
    await expect(conversation(page).getByText("sleep 30").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden({ timeout: 20_000 });
    await send(page, "hello after stop");
    await expect(conversation(page).getByText(FAKE_REPLY)).toHaveCount(1, { timeout: 20_000 });
  });

  test("a fork continues on its own query", async () => {
    const source = conversationIdOf(page);
    await page.getByRole("button", { name: "Message actions" }).last().click();
    await page.getByRole("menuitem", { name: "Fork from here" }).click();
    await expect.poll(() => conversationIdOf(page)).not.toBe(source);
    await expect(page.getByRole("link", { name: /Fork of/ }).first()).toBeVisible();
    await send(page, "hello from the fork");
    await expect(conversation(page).getByText(FAKE_REPLY).last()).toBeVisible({ timeout: 20_000 });
  });
});
