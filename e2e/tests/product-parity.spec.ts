import { existsSync } from "node:fs";
import { mkdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  createParityHarness,
  parityUserEntries,
  parityView,
} from "../../packages/cli/src/commands/product-parity-support";
import { viewToText } from "../../packages/protocol/src/index";

const lease = join(
  process.platform === "darwin" ? "/private/tmp" : tmpdir(),
  "tau-product-recovery-heavy-15158add-7047a3536d29f345d2d4b6118abf1e5db33f9231dccee11c742c44faec29878c.lock",
);
const staticDir = fileURLToPath(new URL("../../packages/web/dist", import.meta.url));

test("C.web-cli-send-B: actual Send control and CLI preserve node-scoped persisted state", async ({
  page,
}) => {
  test.setTimeout(300_000);
  if (!existsSync(`${staticDir}/index.html`))
    throw new Error("BLOCKED: build this worktree's candidate web assets under the shared lease first");
  let owned = false;
  let web: Awaited<ReturnType<typeof createParityHarness>> | undefined;
  let cli: Awaited<ReturnType<typeof createParityHarness>> | undefined;
  try {
    for (;;) {
      try {
        await mkdir(lease);
        owned = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const cliBinary = process.env.TAU_PRODUCT_PARITY_BINARY;
    web = await createParityHarness({ staticDir, cliBinary });
    cli = await createParityHarness({ cliBinary });
    const webReplica = web;
    const cliReplica = cli;
    const webA = viewToText(await parityView(web.a, "7"));
    const cliA = viewToText(await parityView(cli.a, "7"));
    const text = "C-equivalent-message";
    const requestId = "C.equivalent-send";
    await page.route("**/api/conversations/7/messages", async (route) => {
      const body = route.request().postDataJSON();
      await route.continue({ postData: JSON.stringify({ ...body, requestId }) });
    });
    await page.goto(web.local.url);
    await page.goto(`${web.local.origin}/n/${encodeURIComponent(web.nodeB)}/p/home/c/7`);
    const message = page.getByRole("textbox", { name: "Message" });
    await expect(message).toBeVisible();
    await message.fill(text);
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/conversations/7/messages") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const admission = await response;
    expect(admission.ok()).toBe(true);
    const webReceipt = await admission.json();
    expect(typeof webReceipt.submissionId).toBe("number");
    await expect
      .poll(async () => parityUserEntries(await parityView(webReplica.b, "7"), text).length)
      .toBe(1);
    const result = await cli.cli([
      "threads",
      "send",
      "7",
      text,
      "--request-id",
      requestId,
      "--node",
      cli.nodeB,
      "--machine",
    ]);
    expect(result.exit, result.stderr).toBe(0);
    expect(result.frames[0]).toMatchObject({ kind: "receipt", threadId: "7", requestId, nodeId: cli.nodeB });
    await expect
      .poll(async () => parityUserEntries(await parityView(cliReplica.b, "7"), text).length)
      .toBe(1);
    for (const replica of [web, cli]) {
      const beforeRetry = parityUserEntries(await parityView(replica.b, "7"), text);
      expect(beforeRetry).toHaveLength(1);
      expect(new Set(beforeRetry.map((entry) => entry.id)).size).toBe(1);
      const retry = await replica.cli([
        "threads",
        "send",
        "7",
        text,
        "--request-id",
        requestId,
        "--node",
        replica.nodeB,
        "--machine",
      ]);
      expect(retry.exit, retry.stderr).toBe(0);
      expect(retry.frames[0].submissionId).toBe(
        replica === web ? webReceipt.submissionId : result.frames[0].submissionId,
      );
      const afterRetry = parityUserEntries(await parityView(replica.b, "7"), text);
      expect(afterRetry).toHaveLength(1);
      expect(afterRetry.map((entry) => entry.id)).toEqual(beforeRetry.map((entry) => entry.id));
    }
    expect(viewToText(await parityView(web.a, "7"))).toBe(webA);
    expect(viewToText(await parityView(cli.a, "7"))).toBe(cliA);
    // This fake-Core application equivalence is deliberately not native SDK/denied-Edit proof.
  } finally {
    await page.close();
    await web?.close();
    await cli?.close();
    if (owned) await rmdir(lease);
  }
});
