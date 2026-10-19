import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { startUpdateServer, type UpdateServer } from "../update-support";

test.describe.configure({ mode: "serial" });

async function openAsOwner(page: Page, server: UpdateServer) {
  const token = readFileSync(join(server.home, "token"), "utf8").trim();
  await page.goto(`${server.baseURL}/?token=${encodeURIComponent(token)}`);
  const addKey = page
    .getByRole("listitem", { name: "OpenRouter", exact: true })
    .getByRole("button", { name: "Add key" });
  await addKey.or(page.getByRole("button", { name: "Settings" })).waitFor();
  if (!(await addKey.isVisible())) return;
  await addKey.click();
  await page.getByLabel("OpenRouter API key").fill("sk-or-v1-faux");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("combobox", { name: "Default model" }).click();
  await page.getByRole("option", { name: /Faux One/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
}

test.describe("update button on an updatable install", () => {
  let server: UpdateServer;
  test.beforeAll(async () => {
    server = await startUpdateServer("npm-global");
  });
  test.afterAll(async () => {
    await server.stop();
  });

  test("a paired device gets 403 on POST /api/update/start", async ({ page, browser }) => {
    await openAsOwner(page, server);
    const minted = await page.request.post(`${server.baseURL}/api/pair?kind=device`, {
      headers: { origin: server.baseURL },
    });
    expect(minted.status()).toBe(200);
    const { code } = (await minted.json()) as { code: string };
    const device = await browser.newContext();
    const redeemed = await device.request.post(`${server.baseURL}/api/pair/redeem`, {
      data: { code, deviceName: "Phone" },
      headers: { origin: server.baseURL },
    });
    expect(redeemed.status()).toBe(200);
    const body = { target: "9.9.9", force: false };
    const refused = await device.request.post(`${server.baseURL}/api/update/start`, {
      data: body,
      headers: { origin: server.baseURL },
    });
    expect(refused.status()).toBe(403);
    const status = await device.request.get(`${server.baseURL}/api/update`);
    expect(((await status.json()) as { canUpdate: boolean }).canUpdate).toBe(false);
    await device.close();
  });

  test("the owner sees Update, confirms, and the page reloads on the new version with a toast", async ({
    page,
  }) => {
    await openAsOwner(page, server);
    const update = page.getByRole("button", { name: "Update", exact: true });
    await expect(update).toBeVisible({ timeout: 30_000 });
    await update.click();
    const dialog = page.getByRole("alertdialog", { name: "Update tau to 9.9.9?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    await update.click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Update and restart" }).click();
    await expect(page.getByRole("button", { name: "Updating…" })).toBeVisible();
    await expect(page.getByText("tau updated to 9.9.9")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: /^Update/ })).toHaveCount(0);
    const status = await page.request.get(`${server.baseURL}/api/update`);
    expect(await status.json()).toMatchObject({ current: "9.9.9", behind: false, job: { state: "idle" } });
  });
});

test.describe("update button on an npx install", () => {
  let server: UpdateServer;
  test.beforeAll(async () => {
    server = await startUpdateServer("npx");
  });
  test.afterAll(async () => {
    await server.stop();
  });

  test("manual mode shows the command to copy and starts nothing", async ({ page }) => {
    await openAsOwner(page, server);
    const update = page.getByRole("button", { name: "Update", exact: true });
    await expect(update).toBeVisible({ timeout: 30_000 });
    await update.click();
    const dialog = page.getByRole("dialog", { name: "Update tau" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("npm i -g @pablopunk/tau@latest && tau restart")).toBeVisible();
    const status = await page.request.get(`${server.baseURL}/api/update`);
    expect(await status.json()).toMatchObject({
      install: { mode: "manual" },
      job: { state: "idle" },
    });
  });
});
