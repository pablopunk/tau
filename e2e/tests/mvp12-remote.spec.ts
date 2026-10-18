import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { tokenFile } from "../support";

const readToken = () => readFileSync(tokenFile(), "utf8").trim();

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

/** Opens a socket in the page; resolves to how it ended. */
function socketOutcome(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const socket = new WebSocket(`ws://${location.host}/api/live`);
        (window as unknown as { probe: WebSocket }).probe = socket;
        socket.onopen = () => resolve("open");
        socket.onclose = () => resolve("closed");
      }),
  );
}

test("Stage 1 with the fake tunnel: link a second browser, then revoke it", async ({ browser, baseURL }) => {
  const owner = await browser.newPage();
  await owner.goto(`/?token=${encodeURIComponent(readToken())}`);
  await completeSetup(owner);
  await owner.getByRole("button", { name: "Settings" }).click();
  const settings = owner.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("navigation", { name: "Settings sections" }).getByText("Remote access").click();

  const remoteSwitch = settings.getByRole("switch");
  if (!(await remoteSwitch.isChecked())) await remoteSwitch.click();
  await expect(settings.getByText(/fake-\d+\.tunnel\.test/)).toBeVisible();

  await settings.getByRole("button", { name: "Link a device" }).click();
  const dialog = owner.getByRole("dialog", { name: "Link a device" });
  const shortCode = (await dialog.getByText(/^[A-Z2-9]{4} [A-Z2-9]{4}$/).textContent()) ?? "";
  expect(shortCode).not.toBe("");
  await expect(dialog.getByText(/Waiting for the device/)).toBeVisible();

  const second = await browser.newContext();
  const guest = await second.newPage();
  await guest.goto(`${baseURL}/pair`);
  await guest.locator("#code").fill(shortCode);
  await guest.locator("#name").fill("Second browser");
  await guest.getByRole("button", { name: "Link this device" }).click();
  await guest.waitForURL(`${baseURL}/`);

  await expect(dialog.getByText("Linked: Second browser")).toBeVisible();
  expect((await second.request.get(`${baseURL}/api/settings`)).status()).toBe(200);
  expect(await socketOutcome(guest)).toBe("open");

  await dialog.getByRole("button", { name: "Close" }).first().click();
  await settings.getByRole("button", { name: "Revoke Second browser" }).click();
  await owner.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();

  await expect.poll(async () => (await second.request.get(`${baseURL}/api/settings`)).status()).toBe(401);
  await expect
    .poll(() => guest.evaluate(() => (window as unknown as { probe: WebSocket }).probe.readyState))
    .toBe(WebSocket.CLOSED);
  await second.close();
  await owner.close();
});
