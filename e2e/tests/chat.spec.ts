import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { bareRepository, homeDir, tokenFile } from "../support";

const readToken = () => readFileSync(tokenFile(), "utf8").trim();
const conversation = (page: Page) => page.getByTestId("conversation");
const sidebar = (page: Page) => page.getByRole("complementary").or(page.getByLabel("Projects and threads"));

async function completeSetup(page: Page) {
  await page.getByLabel("OpenRouter API key").fill("sk-or-v1-faux");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("combobox", { name: "Default model" }).click();
  await page.getByRole("option", { name: /Faux One/ }).click();
  await page.getByRole("combobox", { name: "Fast model (optional)" }).click();
  await page.getByRole("option", { name: /Faux Fast/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

async function openNewThreadIn(page: Page, project: string) {
  await page.getByRole("button", { name: `New thread in ${project}` }).click();
  await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveText(project);
}

test.describe.configure({ mode: "serial" });

test.describe("MVP2 flow", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(`/?token=${encodeURIComponent(readToken())}`);
  });

  test.afterAll(() => page.close());

  test("setup lands on the new thread page, Home runs a tool and the title appears", async () => {
    await completeSetup(page);
    await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();
    await page.getByRole("radio", { name: "Projects" }).click();

    await send(page, "write hello.txt hi");

    const runningDot = sidebar(page).locator('[data-slot="bot-avatar"][data-working="true"]');
    await expect(sidebar(page).getByRole("link", { name: "write hello.txt hi" })).toBeVisible();
    await expect(runningDot).toHaveCount(0);

    const hello = join(homeDir(), "hello.txt");
    await expect.poll(() => existsSync(hello)).toBe(true);
    expect(readFileSync(hello, "utf8")).toBe("hi");
    await expect(sidebar(page).getByRole("link", { name: "write hello.txt hi" })).toBeVisible();
    await expect(conversation(page).getByText("write hello.txt hi", { exact: true }).last()).toBeVisible();
  });

  test("clones a local bare repository and starts a thread in it", async () => {
    await page.getByRole("button", { name: "New thread", exact: true }).click();
    await page.getByRole("combobox", { name: "Project" }).click();
    await page.getByRole("option", { name: /Add project/ }).click();
    await page.getByRole("tab", { name: "Git URL" }).click();
    await page.getByLabel("Repository URL").fill(bareRepository());
    await page.getByRole("button", { name: "Clone project" }).click();

    const newThread = page.getByRole("button", { name: "New thread in remote" });
    await expect(newThread).toBeVisible({ timeout: 20_000 });
    await openNewThreadIn(page, "remote");
    await send(page, "hello from the clone");
    await expect(conversation(page).getByText("hello from the clone", { exact: true })).toBeVisible();
  });

  test("an image reply counts one image", async () => {
    await openNewThreadIn(page, "Home");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page
      .getByLabel("Choose images")
      .setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: png });
    await send(page, "image");
    await expect(conversation(page).getByText("Images received: 1")).toBeVisible();
  });

  test("a failed run can be retried", async () => {
    await openNewThreadIn(page, "Home");
    await send(page, "fail");
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(retry).toBeHidden();
    await expect(sidebar(page).getByRole("img", { name: "Failed" })).toBeHidden();
  });

  test("switches the model of a thread from the composer", async () => {
    await openNewThreadIn(page, "Home");
    await send(page, "hello");
    const model = conversation(page).getByRole("combobox", { name: "Model" });
    await expect(model).toContainText("Faux One");
    await model.click();
    await page.getByRole("option", { name: /Faux Two/ }).click();
    await expect(model).toContainText("Faux Two");
  });

  test("archives and deletes a thread", async () => {
    const thread = sidebar(page).getByRole("link", { name: "fail" });
    await thread.hover();
    await page.getByRole("button", { name: "Actions for fail" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(thread).toBeHidden();

    await page.getByRole("button", { name: /Archived/ }).click();
    await expect(thread).toBeVisible();
    await thread.hover();
    await page.getByRole("button", { name: "Actions for fail" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete thread" }).click();
    await expect(thread).toBeHidden();
  });
});
