import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { homeDir, tokenFile } from "../support";

const readToken = () => readFileSync(tokenFile(), "utf8").trim();
const sidebar = (page: Page) => page.getByRole("complementary").or(page.getByLabel("Projects and threads"));
const terminal = (page: Page) => page.getByRole("region", { name: "Terminal" });
const FORTY_TWO = /(^|\s)42(\s|$)/;
const daemonPath = () =>
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../packages/cli/node_modules/@earendil-works/pi-env/bin",
    `pi-env-${process.platform}-${process.arch}`,
    "pi-env",
  );

async function completeSetup(page: Page) {
  const addKey = page
    .getByRole("listitem", { name: "OpenRouter", exact: true })
    .getByRole("button", { name: "Add key" });
  await addKey.or(page.getByRole("heading", { name: "New thread" })).waitFor();
  if (!(await addKey.isVisible())) return;
  await addKey.click();
  await page.getByLabel("OpenRouter API key").fill("sk-or-v1-faux");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("combobox", { name: "Default model" }).click();
  await page.getByRole("option", { name: /Faux One/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

async function startThread(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(sidebar(page).getByRole("link", { name: text })).toBeVisible();
}

async function run(page: Page, command: string) {
  await terminal(page).locator("textarea").focus();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test.describe.configure({ mode: "serial" });

test.describe("terminal pane", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(`/?token=${encodeURIComponent(readToken())}`);
    await completeSetup(page);
    await startThread(page, "terminal thread one");
  });

  test.afterAll(() => page.close());

  test("the packaged daemon exists and is executable", () => {
    expect(statSync(daemonPath()).isFile()).toBe(true);
    expect(() => accessSync(daemonPath(), constants.X_OK)).not.toThrow();
  });

  test("opens a shell in the thread folder, runs a command, replays after a reload, and closes", async () => {
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(page).toHaveURL(/\/terminal\/[^/]+$/);
    await run(page, "echo $((6*7))");
    await expect(terminal(page)).toContainText(FORTY_TWO);
    await run(page, "pwd");
    await expect(terminal(page)).toContainText(homeDir());

    await page.reload();
    await expect(terminal(page)).toContainText(FORTY_TWO);

    await page.getByRole("button", { name: /^Close / }).click();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(terminal(page)).toHaveCount(0);
  });

  test("archiving the thread kills its shell", async () => {
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await run(page, "echo pid=$$");
    await expect(terminal(page)).toContainText(/pid=\d+\s/);
    const text = (await terminal(page).textContent()) ?? "";
    const pid = Number([...text.matchAll(/pid=(\d+)/g)].at(-1)?.[1]);
    expect(alive(pid)).toBe(true);

    const thread = sidebar(page).getByRole("link", { name: /terminal thread one/ });
    await thread.hover();
    await sidebar(page)
      .getByRole("button", { name: /^Archive .*terminal thread one/ })
      .click();
    await expect(thread).toBeHidden();
    await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false);
  });
});
