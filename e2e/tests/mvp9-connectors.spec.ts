import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { PORT, tokenFile } from "../support";

const ORIGIN = { Origin: `http://127.0.0.1:${PORT}` };
const TOOL_REPLY = "Fake Claude ran the tool.";
const READ_RESULT = "Fake connector result for list_teams.";
const WRITE_RESULT = "Fake connector result for save_comment.";
const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message" });
const conversation = (page: Page) => page.getByTestId("conversation");
const approvalCard = (page: Page) => page.getByRole("region", { name: "Tool approval" });

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

async function openSettingsSection(page: Page, name: string) {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name }).click();
}

async function acceptTheNoticeIfNeeded(page: Page) {
  await openSettingsSection(page, "Providers");
  const row = page.getByRole("listitem", { name: "Anthropic" });
  const accept = row.getByRole("button", { name: "I understand for Anthropic" });
  await expect(row).toContainText("Fake Org");
  if (await accept.isVisible()) await accept.click();
  await expect(row).toContainText("Claude CLI login");
  await page.keyboard.press("Escape");
}

async function turnOnLinear(page: Page) {
  await openSettingsSection(page, "Tools");
  const linear = page.getByRole("switch", { name: "claude.ai Linear" });
  await expect(linear).toBeVisible();
  await linear.click();
  await expect(linear).toBeChecked();
  await page.keyboard.press("Escape");
}

async function pickHaiku(page: Page) {
  const picker = page.getByRole("combobox", { name: "Model" });
  await picker.click();
  await page.getByRole("option", { name: /Haiku 5\.5 \(haiku\)/ }).click();
  await expect(picker).toContainText("Claude CLI · Haiku 5.5");
}

const cardsTitled = (page: Page, title: string) => conversation(page).getByRole("button", { name: title });

async function expectLastCardResult(page: Page, title: string, result: string) {
  await cardsTitled(page, title).last().click();
  await expect(conversation(page).getByText(result).last()).toBeVisible({ timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("MVP10 Claude connectors with the fake Agent SDK", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(`/?token=${encodeURIComponent(readFileSync(tokenFile(), "utf8").trim())}`);
    await connectFauxProvider(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();
  });

  test.afterAll(() => page.close());

  test("turn on Linear in Settings and start a Claude CLI thread", async () => {
    await acceptTheNoticeIfNeeded(page);
    await turnOnLinear(page);
    await page.getByRole("button", { name: "New thread", exact: true }).click();
    await pickHaiku(page);
  });

  test("a read-only call shows a connector card with its result and no approval", async () => {
    await send(page, "connector Linear list_teams");
    await expect(page).toHaveURL(/\/c\//);
    await expect(cardsTitled(page, "Linear · list_teams")).toHaveCount(1, { timeout: 30_000 });
    await expectLastCardResult(page, "Linear · list_teams", READ_RESULT);
    await expect(conversation(page).getByText(TOOL_REPLY)).toHaveCount(1, { timeout: 30_000 });
    await expect(approvalCard(page)).toHaveCount(0);
  });

  test("a write call asks, Allow once runs it", async () => {
    await send(page, "connector Linear save_comment");
    await expect(approvalCard(page)).toBeVisible({ timeout: 30_000 });
    await expect(approvalCard(page)).toContainText("Linear · save_comment");
    await approvalCard(page).getByRole("button", { name: "Allow once" }).click();
    await expect(cardsTitled(page, "Linear · save_comment")).toHaveCount(1, { timeout: 30_000 });
    await expectLastCardResult(page, "Linear · save_comment", WRITE_RESULT);
    await expect(approvalCard(page)).toHaveCount(0);
  });

  test("a write call asks, Deny keeps it from running", async () => {
    await send(page, "connector Linear save_comment");
    await expect(approvalCard(page)).toBeVisible({ timeout: 30_000 });
    await approvalCard(page).getByRole("button", { name: "Deny" }).click();
    await expect(approvalCard(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden({ timeout: 30_000 });
    await expect(cardsTitled(page, "Linear · save_comment")).toHaveCount(2);
    await expectLastCardResult(page, "Linear · save_comment", "The user denied this tool call.");
  });

  test("Always allow runs the tool now and without asking next time", async () => {
    await send(page, "connector Linear save_comment");
    await expect(approvalCard(page)).toBeVisible({ timeout: 30_000 });
    await approvalCard(page).getByRole("button", { name: "Always allow this tool" }).click();
    await expect(cardsTitled(page, "Linear · save_comment")).toHaveCount(3, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden({ timeout: 30_000 });
    await send(page, "connector Linear save_comment");
    await expect(cardsTitled(page, "Linear · save_comment")).toHaveCount(4, { timeout: 30_000 });
    await expect(approvalCard(page)).toHaveCount(0);
  });
});
