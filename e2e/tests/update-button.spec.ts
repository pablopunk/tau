import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  type BinaryServer,
  ensureReleases,
  type FakeGitHub,
  GOOD_VERSION,
  INSTALLED_VERSION,
  serveReleases,
  startBinaryServer,
  updateDiagnostics,
} from "../binary-support";
import { startDevCheckoutServer, type UpdateServer } from "../update-support";

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

test.describe("update button on an installed binary", () => {
  let server: BinaryServer;
  let github: FakeGitHub;
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    const releases = await ensureReleases();
    github = await serveReleases(releases, GOOD_VERSION);
    server = await startBinaryServer(releases, github);
  });
  test.afterEach(({}, info) => {
    if (info.status !== info.expectedStatus && server) console.log(updateDiagnostics(server));
  });
  test.afterAll(async () => {
    await server?.stop();
    await github?.close();
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
    const refused = await device.request.post(`${server.baseURL}/api/update/start`, {
      data: { target: GOOD_VERSION, force: false },
      headers: { origin: server.baseURL },
    });
    expect(refused.status()).toBe(403);
    const status = await device.request.get(`${server.baseURL}/api/update`);
    expect(((await status.json()) as { canUpdate: boolean }).canUpdate).toBe(false);
    await device.close();
  });

  test("the owner sees Update, confirms, and the page shows the new version", async ({ page }) => {
    test.setTimeout(180_000);
    await openAsOwner(page, server);
    const update = page.getByRole("button", { name: "Update", exact: true });
    await expect(update).toBeVisible({ timeout: 60_000 });
    await update.click();
    const dialog = page.getByRole("alertdialog", { name: `Update tau to ${GOOD_VERSION}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    await update.click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Update and restart" }).click();
    await expect(page.getByText(`tau updated to ${GOOD_VERSION}`)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole("button", { name: /^Update/ })).toHaveCount(0);
    const status = await page.request.get(`${server.baseURL}/api/update`);
    expect(await status.json()).toMatchObject({
      current: GOOD_VERSION,
      behind: false,
      job: { state: "idle" },
    });
    expect(INSTALLED_VERSION).not.toBe(GOOD_VERSION);
  });
});

test.describe("update button in a dev checkout", () => {
  let server: UpdateServer;
  test.beforeAll(async () => {
    server = await startDevCheckoutServer();
  });
  test.afterAll(async () => {
    await server?.stop();
  });

  test("shows no Update button and refuses to start one", async ({ page }) => {
    await openAsOwner(page, server);
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Update/ })).toHaveCount(0);
    const status = await page.request.get(`${server.baseURL}/api/update`);
    expect(await status.json()).toMatchObject({ install: { mode: "none" }, job: { state: "idle" } });
  });
});
