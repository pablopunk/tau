import { readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { conversationPath } from "../../packages/web/src/lib/paths";
import {
  type BrowserDescriptor,
  digest,
  LONG_STREAM_TEXT,
  validateBrowserDescriptor,
} from "../../scripts/product-artifact-support";

test("compiled artifact: frontend bytes, visible first text, follow-up, reattach", async ({ browser }) => {
  test.setTimeout(180_000);
  const path = process.env.TAU_ARTIFACT_DESCRIPTOR;
  if (!path) throw new Error("BLOCKED: missing owned artifact descriptor; no default endpoint");
  const descriptor: BrowserDescriptor = JSON.parse(await readFile(path, "utf8"));
  await validateBrowserDescriptor(descriptor);
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 1440, height: 900 },
  });
  const observedAssets = new Map<string, string>();
  const pending: Promise<void>[] = [];
  const errors: string[] = [];
  try {
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === descriptor.base ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin !== descriptor.base || !/\.(js|css)$/.test(url.pathname)) return;
      pending.push(
        (async () => {
          if (response.status() !== 200 || response.fromServiceWorker())
            errors.push("cached_or_failed_asset");
          observedAssets.set(`web${url.pathname}`, digest(await response.body()));
        })(),
      );
    });
    await page.goto(`${descriptor.base}/?token=${encodeURIComponent(descriptor.token)}`);
    const indexResponse = await page.request.get(`${descriptor.base}/`, {
      headers: { "Cache-Control": "no-cache" },
    });
    expect(digest(await indexResponse.body())).toBe(descriptor.web.index.sha256);
    let threadId = descriptor.threadId;
    if (descriptor.phase === "long-stream") {
      await page.goto(`${descriptor.base}/new?project=${encodeURIComponent(descriptor.projectId)}`);
      await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();
      await page.getByRole("textbox", { name: "Message" }).fill("product recovery long stream");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page).toHaveURL(/\/p\/[^/]+\/c\/[^/]+$/);
      threadId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1) ?? "");
      expect(threadId).not.toBe("");
    } else {
      await page.goto(`${descriptor.base}${conversationPath(descriptor.projectId, threadId)}`);
    }
    const messages = page.getByTestId("assistant-message").locator(":scope > .break-words");
    const assistant = messages.filter({ hasText: /^E_(FIRST|FOLLOWUP)_ASSISTANT_TEXT$/ });
    const longStreamAssistant = messages.filter({ hasText: "E_LONG_STREAM_START:" });
    let firstTextVisible = false;
    let firstTextLength = 0;
    let firstAssistantCount = 0;
    let followupAssistantCount = 0;
    let followupTextLength = 0;
    let longStreamComplete = false;
    let longStreamTextLength = 0;
    let longStreamProgressed = false;
    const idle = async () => {
      await expect
        .poll(
          async () => {
            const response = await page.request.get(`${descriptor.base}/api/conversations`, {
              headers: { Authorization: `Bearer ${descriptor.token}` },
            });
            expect(response.status()).toBe(200);
            const thread = (await response.json()).find((t: { id: string }) => t.id === threadId);
            return thread?.status === "idle" && thread?.lastRunEndedAt !== null;
          },
          { timeout: 120_000 },
        )
        .toBe(true);
    };
    if (descriptor.phase === "long-stream") {
      const message = longStreamAssistant.first();
      await expect(message).toContainText("E_LONG_STREAM_START:", { timeout: 45_000 });
      firstTextVisible = true;
      const initialText = (await message.textContent()) ?? "";
      firstTextLength = initialText.length;
      await expect
        .poll(async () => ((await message.textContent()) ?? "").endsWith(":E_LONG_STREAM_END"), {
          timeout: 120_000,
        })
        .toBe(true);
      const finalText = (await message.textContent()) ?? "";
      expect(finalText).toBe(LONG_STREAM_TEXT);
      longStreamComplete = finalText === LONG_STREAM_TEXT;
      longStreamTextLength = finalText.length;
      longStreamProgressed = initialText.length < finalText.length;
      firstAssistantCount = await longStreamAssistant.count();
      followupAssistantCount = firstAssistantCount;
      await idle();
    } else {
      await expect(assistant.getByText("E_FIRST_ASSISTANT_TEXT", { exact: true })).toBeVisible({
        timeout: 45_000,
      });
      await expect.poll(async () => (await assistant.first().innerText()).trim().length).toBeGreaterThan(0);
      firstTextVisible = true;
      firstTextLength = (await assistant.first().innerText()).trim().length;
      firstAssistantCount = await assistant.count();
      followupAssistantCount = firstAssistantCount;
      await idle();
    }
    if (descriptor.phase === "first") {
      const textbox = page.getByRole("textbox", { name: "Message" });
      await textbox.fill("product recovery distinct follow-up");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(assistant.getByText("E_FOLLOWUP_ASSISTANT_TEXT", { exact: true })).toBeVisible({
        timeout: 45_000,
      });
      await expect.poll(() => assistant.count(), { timeout: 45_000 }).toBeGreaterThan(firstAssistantCount);
      await expect.poll(async () => (await assistant.last().innerText()).trim().length).toBeGreaterThan(0);
      await idle();
      followupAssistantCount = await assistant.count();
      followupTextLength = (await assistant.last().innerText()).trim().length;
    }
    await page.reload();
    if (descriptor.phase === "long-stream") {
      const replayed = longStreamAssistant.first();
      await expect(replayed).toBeVisible();
      await expect.poll(async () => (await replayed.textContent()) ?? "").toBe(LONG_STREAM_TEXT);
    } else {
      await expect(assistant.first()).toBeVisible();
    }
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 360, height: 640 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    }
    await Promise.all(pending);
    expect(errors).toEqual([]);
    for (const file of [...descriptor.web.js, ...descriptor.web.css]) {
      if (!observedAssets.has(file.path)) {
        // Lazy chunks must also be served by this binary, but are not claimed executed.
        const response = await page.request.get(`${descriptor.base}/${file.path.replace(/^web\//, "")}`);
        expect(response.status()).toBe(200);
        observedAssets.set(file.path, digest(await response.body()));
      }
      expect(observedAssets.get(file.path)).toBe(file.sha256);
    }
    await validateBrowserDescriptor(descriptor);
    await writeFile(
      descriptor.output,
      JSON.stringify({
        nonce: descriptor.nonce,
        phase: descriptor.phase,
        threadId,
        firstTextVisible,
        firstTextLength,
        firstAssistantCount,
        followupAssistantCount,
        followupTextLength,
        longStreamComplete,
        longStreamTextLength,
        longStreamProgressed,
        terminal: true,
        frontendVerified: true,
        assetResponses: observedAssets.size,
        frontendScope: "loaded responses plus fetched lazy chunks; not all chunks executed",
        browserResourceScope: "unmeasured",
      }),
      { flag: "wx", mode: 0o600 },
    );
  } finally {
    await context.close();
  }
});
