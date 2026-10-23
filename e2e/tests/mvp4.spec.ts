import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { tokenFile } from "../support";

const CALLBACK = "http://127.0.0.1:1455/auth/callback?code=ok&state=faux";
const SECTIONS = ["General", "Providers", "Models", "Projects", "GitHub"];
const PHONE = { width: 390, height: 800 };
const DESKTOP = { width: 1280, height: 800 };

const readToken = () => readFileSync(tokenFile(), "utf8").trim();
const providerRow = (page: Page, name: string) => page.getByRole("listitem", { name, exact: true });

async function completeSetup(page: Page) {
  // A retry reuses the already-configured server: the setup screen shows only once.
  await expect(
    page.getByRole("heading", { name: "New thread" }).or(page.getByRole("heading", { name: /Welcome to/ })),
  ).toBeVisible();
  if ((await page.getByRole("heading", { name: "New thread" }).count()) > 0) return;
  await page
    .getByRole("listitem", { name: "OpenRouter", exact: true })
    .getByRole("button", { name: "Add key" })
    .click();
  await page.getByLabel("OpenRouter API key").fill("sk-or-v1-faux");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("combobox", { name: "Default model" }).click();
  await page.getByRole("option", { name: /Faux One/ }).click();
  await page.getByRole("combobox", { name: "Fast model (optional)" }).click();
  await page.getByRole("option", { name: /Faux Fast/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

async function disconnect(page: Page, row: ReturnType<typeof providerRow>, name: string) {
  await row.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: `Disconnect for ${name}` }).click();
  await row.getByRole("button", { name: "Confirm disconnect" }).click();
}
const sendButton = (page: Page) => page.getByRole("button", { name: "Send", exact: true });

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

async function openProviders(page: Page) {
  await openSettings(page);
  await page.getByRole("button", { name: "Providers" }).click();
}

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await sendButton(page).click();
}

const bigText = (tag: string) => `${tag} ${"lorem ipsum ".repeat(3500)}`;

async function sendAndWaitForAnswers(page: Page, text: string, answers: number) {
  await send(page, text);
  await expect(page.getByRole("button", { name: "Copy answer" })).toHaveCount(answers, { timeout: 20_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("MVP4", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: DESKTOP });
    await page.goto(`/?token=${encodeURIComponent(readToken())}`);
    await completeSetup(page);
    await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();
  });

  test.afterAll(() => page.close());

  test("settings sections on desktop", async () => {
    await openSettings(page);
    const nav = page.getByRole("navigation", { name: "Settings sections" });
    for (const section of SECTIONS) await expect(nav.getByRole("button", { name: section })).toBeVisible();
    await nav.getByRole("button", { name: "Providers" }).click();
    await expect(page.getByRole("list", { name: "Providers" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("settings sections on a phone", async () => {
    await page.setViewportSize(PHONE);
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await openSettings(page);
    await page.getByRole("button", { name: "Providers" }).click();
    await expect(page.getByRole("list", { name: "Providers" })).toBeVisible();
    await page.getByRole("button", { name: "Back to settings" }).click();
    await expect(page.getByRole("button", { name: "GitHub" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.setViewportSize(DESKTOP);
  });

  test("adds and disconnects a provider key", async () => {
    await openProviders(page);
    const row = providerRow(page, "Google");
    await row.getByRole("button", { name: /key/i }).click();
    await row.getByLabel("Google API key").fill("faux-google-key");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row.getByText("Connected")).toBeVisible();
    await disconnect(page, row, "Google");
    await expect(row.getByText("Not connected")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("signs in with ChatGPT by pasting the callback", async () => {
    await openProviders(page);
    await providerRow(page, "OpenAI").getByRole("button", { name: "Sign in with ChatGPT" }).click();
    const dialog = page.getByRole("dialog", { name: "Sign in with ChatGPT" });
    await expect(dialog.getByRole("link", { name: "Open sign-in page" })).toBeVisible();
    await dialog.getByLabel("Sign-in address").fill(CALLBACK);
    await dialog.getByRole("button", { name: "Submit" }).click();
    await expect(dialog).toBeHidden();
    await expect(providerRow(page, "OpenAI").getByText("ChatGPT plan")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("a wrong ChatGPT address shows an error", async () => {
    await openProviders(page);
    const row = providerRow(page, "OpenAI");
    await disconnect(page, row, "OpenAI");
    await row.getByRole("button", { name: "Sign in with ChatGPT" }).click();
    const dialog = page.getByRole("dialog", { name: "Sign in with ChatGPT" });
    await dialog.getByLabel("Sign-in address").fill("https://example.com/nope");
    await dialog.getByRole("button", { name: "Submit" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row.getByText("Not connected")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("/compact shows the Context compacted divider", async () => {
    await page.getByRole("button", { name: "New thread", exact: true }).click();
    await sendAndWaitForAnswers(page, bigText("one"), 1);
    await sendAndWaitForAnswers(page, bigText("two"), 2);
    await send(page, "/compact");
    await expect(page.getByText("Context compacted")).toBeVisible({ timeout: 20_000 });
  });

  test("@ inserts a file path", async () => {
    await page.getByRole("button", { name: "New thread", exact: true }).click();
    await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();
    const input = page.getByRole("textbox", { name: "Message" });
    await input.pressSequentially("see @hello");
    await page.getByRole("option", { name: /hello\.txt/ }).click();
    await expect(input).toHaveValue(/@hello\.txt/);
  });

  test("the theme survives a reload", async () => {
    await openSettings(page);
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "General" })
      .click();
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
