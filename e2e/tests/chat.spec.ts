import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { projectDir, tokenFile } from "../support";

const readToken = () => readFileSync(tokenFile(), "utf8").trim();

async function completeSetup(page: Page) {
  await page.getByLabel("OpenRouter API key").fill("sk-or-v1-faux");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("combobox", { name: "Default model" }).click();
  await page.getByRole("option", { name: /Faux One/ }).click();
}

async function addProject(page: Page) {
  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByLabel("Folder path").fill(projectDir());
  await page.getByRole("button", { name: "Add project" }).last().click();
}

test("setup, add a project, chat, write a file, reload", async ({ page }) => {
  const name = basename(projectDir());
  await page.goto(`/?token=${encodeURIComponent(readToken())}`);

  await completeSetup(page);
  await addProject(page);
  await page.getByRole("button", { name: `New chat in ${name}` }).click();

  await page.getByLabel("Message").fill("write hello.txt hi");
  await page.getByRole("button", { name: "Send" }).click();

  const hello = join(projectDir(), "hello.txt");
  await expect.poll(() => existsSync(hello)).toBe(true);
  expect(readFileSync(hello, "utf8")).toBe("hi");
  await expect(page.getByTestId("conversation").getByText("write hello.txt hi")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("conversation").getByText("write hello.txt hi")).toBeVisible();
  await expect(page.getByTestId("conversation").getByText("hello.txt").first()).toBeVisible();
});
