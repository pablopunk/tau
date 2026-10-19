import { join } from "node:path";
import { type Browser, devices, type Page } from "@playwright/test";
import type { DemoEnvironment } from "./environment";

export interface SceneContext {
  readonly browser: Browser;
  readonly environment: DemoEnvironment;
  readonly out: string;
}

export interface Scene {
  readonly name: string;
  capture(context: SceneContext): Promise<void>;
}

const HERO_THREAD = "Review checkout before launch";
const DIFF_THREAD = "Cursor pagination for invoices";
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { ...devices["iPhone 15 Pro"], deviceScaleFactor: 2 };
const JPEG_QUALITY = 90;
const SETTLE_MS = 1000;

async function openPage(context: SceneContext, options: Parameters<Browser["newContext"]>[0]) {
  const browserContext = await context.browser.newContext({
    ...options,
    storageState: context.environment.storageState,
  });
  const page = await browserContext.newPage();
  await page.goto(context.environment.url);
  await page.getByRole("button", { name: /sidebar/i }).waitFor();
  return { page, close: () => browserContext.close() };
}

async function shoot(page: Page, context: SceneContext, name: string) {
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: join(context.out, `${name}.jpg`), type: "jpeg", quality: JPEG_QUALITY });
}

async function openSidebar(page: Page) {
  const heroThread = page.getByText(HERO_THREAD).first();
  if (!(await heroThread.isVisible())) await page.getByRole("button", { name: /sidebar/i }).click();
  await heroThread.waitFor();
}

async function openThread(page: Page, title: string, lastWords: string) {
  await openSidebar(page);
  await page.getByText(title).first().click();
  await page.getByText(lastWords).waitFor();
}

const openHeroThread = (page: Page) => openThread(page, HERO_THREAD, "All three reviews are back");

async function expandEdit(page: Page) {
  await page.getByRole("button", { name: /Edit\s+src\/invoices\.js/ }).click();
}

const diffThread: Scene = {
  name: "diff",
  async capture(context) {
    const { page, close } = await openPage(context, { viewport: DESKTOP, deviceScaleFactor: 2 });
    await openThread(page, DIFF_THREAD, "Cursor pagination is in");
    await expandEdit(page);
    await shoot(page, context, "diff");
    await close();
  },
};

const phoneThread: Scene = {
  name: "phone-thread",
  async capture(context) {
    const { page, close } = await openPage(context, PHONE);
    await openHeroThread(page);
    await shoot(page, context, "phone-thread");
    await close();
  },
};

const phoneSidebar: Scene = {
  name: "phone-sidebar",
  async capture(context) {
    const { page, close } = await openPage(context, PHONE);
    await openSidebar(page);
    await shoot(page, context, "phone-sidebar");
    await close();
  },
};

export const scenes: readonly Scene[] = [diffThread, phoneThread, phoneSidebar];
