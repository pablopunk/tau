import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { tokenFile, WITH_COPY, WITHOUT_COPY } from "../support";

const conversation = (page: Page) => page.getByTestId("conversation");
const sidebar = (page: Page) => page.getByRole("complementary").or(page.getByLabel("Projects and threads"));
const threadLinks = (page: Page) => sidebar(page).getByRole("link");

async function pickRepo(page: Page, repo: string) {
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await page.getByRole("combobox", { name: "Project" }).click();
  await page.getByRole("option", { name: new RegExp(repo) }).click();
}

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(conversation(page).getByText(text, { exact: true }).last()).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.describe("MVP3 flow", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(`/?token=${encodeURIComponent(readFileSync(tokenFile(), "utf8").trim())}`);
  });

  test.afterAll(() => page.close());

  test("a repo with a local copy starts a thread there", async () => {
    await pickRepo(page, WITH_COPY);
    await expect(page.getByRole("combobox", { name: "Project" })).toHaveText("with-local-copy");
    await send(page, "hello local copy");
  });

  test("a repo without a local copy is cloned, then a thread starts there", async () => {
    await pickRepo(page, WITHOUT_COPY);
    await page.getByRole("button", { name: "Clone now" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("combobox", { name: "Project" })).toHaveText("without-local-copy");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await page.getByRole("textbox", { name: "Message" }).fill("hello fresh clone");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled({ timeout: 20_000 });
    await send(page, "hello fresh clone");
  });

  test("Threads mode lists the newest thread first, Projects mode groups and collapses", async () => {
    await page.getByRole("radio", { name: "Threads" }).click();
    await expect(threadLinks(page).first()).toContainText("hello fresh clone");
    await expect(threadLinks(page).nth(1)).toContainText("hello local copy");

    await page.getByRole("radio", { name: "Projects" }).click();
    const localThread = sidebar(page).getByRole("link", { name: /hello local copy/ });
    await expect(localThread).toBeVisible();
    await page.getByRole("button", { name: "with-local-copy", exact: true, expanded: true }).click();
    await expect(localThread).toBeHidden();
    await page.getByRole("button", { name: "with-local-copy", exact: true, expanded: false }).click();
    await expect(localThread).toBeVisible();
  });

  test("a project icon changes to an image found in the project", async () => {
    await page.getByRole("button", { name: "Actions for with-local-copy" }).click();
    await page.getByRole("menuitem", { name: "Change icon" }).click();
    await page.getByRole("button", { name: "Open favicon.png" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const icon = sidebar(page).getByRole("group", { name: "with-local-copy" }).locator("img").first();
    await expect(icon).toHaveAttribute("src", /icon/);
  });
});
