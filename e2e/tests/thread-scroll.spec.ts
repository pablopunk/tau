import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { homeDir, tokenFile } from "../support";

const readToken = () => readFileSync(tokenFile(), "utf8").trim();
const conversation = (page: Page) => page.getByTestId("conversation");
const sidebar = (page: Page) => page.getByRole("complementary").or(page.getByLabel("Projects and threads"));

async function completeSetup(page: Page) {
  await page
    .getByRole("listitem", { name: "OpenRouter", exact: true })
    .getByRole("button", { name: "Add key" })
    .click();
  await page.getByLabel("OpenRouter API key").fill("sk-or-v1-faux");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("combobox", { name: "Default model" }).click();
  await page.getByRole("option", { name: /Faux One/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("thread scroll containment", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(`/?token=${encodeURIComponent(readToken())}`);
  });

  test.afterAll(() => page.close());

  test("a long tool-call thread scrolls the transcript, not the page", async () => {
    await completeSetup(page);
    await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();

    // Each write renders a tool card with screen-reader-only status text.
    // Those spans are absolutely positioned: without a positioned ancestor
    // inside the transcript scroller they inflate the page-level scroll
    // container and produce a second, mostly empty scrollbar.
    // Wait for each run to finish before sending the next: while busy the
    // Send button becomes "Send as steer".
    const runningDot = sidebar(page).locator('[data-slot="bot-avatar"][data-working="true"]');
    for (let i = 0; i < 8; i += 1) {
      await send(page, `write scroll${i}.txt line${i}`);
      await expect.poll(() => existsSync(join(homeDir(), `scroll${i}.txt`)), { timeout: 30_000 }).toBe(true);
      await expect(runningDot).toHaveCount(0, { timeout: 60_000 });
    }

    const overflow = await page.evaluate(() => {
      const conv = document.querySelector('[data-testid="conversation"]') as HTMLElement;
      const section = conv.querySelector('section[aria-label="Conversation"]') as HTMLElement;
      const scroller = section.parentElement?.parentElement as HTMLElement;
      const outer = conv.parentElement as HTMLElement;
      return {
        inner: scroller.scrollHeight - scroller.clientHeight,
        conv: conv.scrollHeight - conv.clientHeight,
        outer: outer.scrollHeight - outer.clientHeight,
      };
    });

    // The transcript really overflows: without this the test proves nothing.
    expect(overflow.inner).toBeGreaterThan(100);
    // …but neither the thread root nor the page-level container may scroll.
    expect(overflow.conv).toBeLessThanOrEqual(1);
    expect(overflow.outer).toBeLessThanOrEqual(1);
    await expect(conversation(page).getByText("line7", { exact: false }).last()).toBeVisible();
  });
});
