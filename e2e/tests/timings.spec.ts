/**
 * Timings harness (PLAN-queue-remake, "Measurement track").
 *
 * Drives the real UI against the built CLI (`--faux`), 15 runs per action,
 * workers: 1 (see playwright.config.ts). Each action reports tap-to-confirm
 * (button disabled / optimistic row / pending bubble) split into tap-to-
 * live-reflect (server-confirmed UI), joined by correlation ids.
 *
 * Guard thresholds (fake transport): p95 tap-to-confirm < 100ms, p95
 * tap-to-live-reflect for local actions < 500ms, no action regresses > 20%
 * vs the committed baseline (fail + print diff).
 *
 * Baseline capture: the spec writes `e2e/timings-baseline.json` when the
 * file is absent, or when UPDATE_TIMINGS_BASELINE=1. Otherwise it compares
 * the fresh run against the committed baseline and fails on regression.
 * Server-stage columns (`serverP95`) are null until the server stage hooks
 * land (timing.ts helper is ready; hooks live in core/server files owned by
 * other agents — see the integrator note).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { tokenFile } from "../support";

const BASELINE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "timings-baseline.json");
const RUNS_PER_ACTION = 15;
const CONFIRM_P95_BUDGET_MS = 100;
const REFLECT_P95_BUDGET_MS = 500;
const REGRESSION_FACTOR = 1.2;

const readToken = () => readFileSync(tokenFile(), "utf8").trim();
const conversation = (page: Page) => page.getByTestId("conversation");
const sidebar = (page: Page) => page.getByRole("complementary").or(page.getByLabel("Projects and threads"));
const idle = (page: Page) =>
  expect(sidebar(page).locator('[data-slot="bot-avatar"][data-working="true"]')).toHaveCount(0, {
    timeout: 180_000,
  });

async function completeSetup(page: Page) {
  // Provider detection settles asynchronously: OpenRouter may show "Add key"
  // or already be connected ("Replace key"). Either state leads to Continue.
  const row = page.getByRole("listitem", { name: "OpenRouter", exact: true });
  await expect(row.getByRole("button", { name: /key/i }).first()).toBeVisible({ timeout: 30_000 });
  if (await row.getByRole("button", { name: "Add key" }).count()) {
    await row.getByRole("button", { name: "Add key" }).click({ timeout: 15_000 });
    await page.getByLabel("OpenRouter API key").fill("sk-or-v1-faux");
    await page.getByRole("button", { name: "Save" }).click({ timeout: 15_000 });
    await expect(row.getByRole("button", { name: "Replace key" })).toBeVisible({ timeout: 30_000 });
  }
  await expect(page.getByText("Continue to choose your models")).toBeVisible({ timeout: 30_000 });
  // The setup page can be taller than the viewport (extra detected providers)
  // and the footer button resists scroll-into-view; DOM-click it (setup is
  // not a measured action, so this distorts nothing).
  const domClick = (locator: import("@playwright/test").Locator) =>
    locator.evaluate((element: HTMLElement) => element.click());
  await domClick(page.getByRole("button", { name: "Continue" }));
  await page.getByRole("combobox", { name: "Default model" }).click({ timeout: 15_000 });
  await page.getByRole("option", { name: /Faux One/ }).click({ timeout: 15_000 });
  await page.getByRole("combobox", { name: "Fast model (optional)" }).click({ timeout: 15_000 });
  await page.getByRole("option", { name: /Faux Fast/ }).click({ timeout: 15_000 });
  await domClick(page.getByRole("button", { name: "Continue" }));
}

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

interface Samples {
  confirm: number[];
  reflect: number[];
}

const samples: Record<string, Samples> = {
  "send-idle": { confirm: [], reflect: [] },
  rename: { confirm: [], reflect: [] },
  archive: { confirm: [], reflect: [] },
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number;
}

function summarize(runs: Samples) {
  const confirm = [...runs.confirm].sort((a, b) => a - b);
  const reflect = [...runs.reflect].sort((a, b) => a - b);
  return {
    p50: percentile(reflect, 50),
    p95: percentile(reflect, 95),
    n: runs.reflect.length,
    confirmP95: percentile(confirm, 95),
    serverP95: null as number | null,
  };
}

function buildSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

test.describe.configure({ mode: "serial" });

test.describe("timings harness", () => {
  let page: Page;
  // Renamed every run; archive toggles it back and forth.
  let title = `timings-${Date.now()}`;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    page = await browser.newPage();
    await page.goto(`/?token=${encodeURIComponent(readToken())}`);
    await completeSetup(page);
    await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();
    // Warmup: create the thread and let the first agent roundtrip settle.
    await send(page, "timings warmup");
    await expect(conversation(page).getByText("timings warmup", { exact: true }).last()).toBeVisible({
      timeout: 30_000,
    });
    await idle(page);
    // Canonicalize the thread title (it came from the first message) without
    // needing to know it: the first Actions button belongs to our only thread.
    // Row actions render on hover only.
    await sidebar(page).getByRole("link").first().hover();
    await sidebar(page)
      .getByRole("button", { name: /Actions for/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Rename thread" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Save" }).dispatchEvent("click");
    await expect(sidebar(page).getByRole("link", { name: title })).toBeVisible({ timeout: 30_000 });
  });

  test.afterAll(async () => {
    const baseline = Object.fromEntries(
      Object.entries(samples).map(([action, runs]) => [action, summarize(runs as Samples)]),
    );
    console.log(`timings summary: ${JSON.stringify(baseline)}`);
    console.log(`timings samples: ${JSON.stringify(samples)}`);
    const previous = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : null;
    // Only a complete green run becomes the baseline: partial runs (a test
    // failed midway) must neither write nor compare.
    const complete = Object.values(baseline).every((entry) => (entry as { n: number }).n === RUNS_PER_ACTION);
    if ((!previous || process.env.UPDATE_TIMINGS_BASELINE === "1") && complete) {
      writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify({ meta: { sha: buildSha(), capturedAt: new Date().toISOString(), runsPerAction: RUNS_PER_ACTION }, ...baseline }, null, 2)}\n`,
      );
    } else if (complete) {
      for (const [action, current] of Object.entries(baseline)) {
        const old = previous[action] as { p95: number } | undefined;
        if (!old) continue;
        expect(
          current.p95,
          `${action} regressed vs baseline: p95 ${current.p95}ms > 1.2x ${old.p95}ms`,
        ).toBeLessThanOrEqual(old.p95 * REGRESSION_FACTOR);
      }
    }
    await page.close();
  });

  test("send-idle: 15 runs", async () => {
    test.setTimeout(600_000);
    const assistantReplies = () => conversation(page).getByTestId("assistant-message").count();
    // One unrecorded warmup: the first tap after load pays bundle/hydration
    // costs that have nothing to do with the action.
    for (let i = -1; i < RUNS_PER_ACTION; i++) {
      const text = `timing message ${i} ${Date.now()}`;
      const repliesBefore = await assistantReplies();
      await page.getByRole("textbox", { name: "Message" }).fill(text);
      // Confirm: the composer clears right after the tap (fill excluded).
      // dispatchEvent measures app latency (sync setState + render), not the
      // driver's mouse-input pipeline.
      const start = Date.now();
      await page.getByRole("button", { name: "Send", exact: true }).dispatchEvent("click");
      await expect(page.getByRole("textbox", { name: "Message" })).toBeEmpty({ timeout: 10_000 });
      const confirmMs = Date.now() - start;
      // Reflect: the bubble is server-confirmed via live ops.
      await expect(conversation(page).getByText(text, { exact: true }).last()).toBeVisible({
        timeout: 30_000,
      });
      if (i >= 0) {
        samples["send-idle"]?.confirm.push(confirmMs);
        samples["send-idle"]?.reflect.push(Date.now() - start);
      }
      // Quiescence gate: admit can wait on the previous run's trailing commit,
      // so avatar-idle alone lets the next send time a queue drain instead of
      // an admit. Wait for the run's reply, then idle, then a settle margin.
      await expect.poll(() => assistantReplies(), { timeout: 180_000 }).toBeGreaterThan(repliesBefore);
      await idle(page);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    const summary = summarize(samples["send-idle"] as Samples);
    expect(summary.confirmP95).toBeLessThan(CONFIRM_P95_BUDGET_MS);
    expect(summary.p95).toBeLessThan(REFLECT_P95_BUDGET_MS);
  });

  test("rename: 15 runs", async () => {
    test.setTimeout(600_000);
    for (let i = -1; i < RUNS_PER_ACTION; i++) {
      const next = `timed-${i}`;
      const row = sidebar(page).getByRole("link", { name: title });
      await row.hover();
      await sidebar(page)
        .getByRole("button", { name: `Actions for ${title}` })
        .click();
      await page.getByRole("menuitem", { name: "Rename thread" }).click();
      await page.getByLabel("Title").fill(next);
      // Confirm: instant acknowledgment of the tap (menu navigation excluded).
      // dispatchEvent measures app latency, not the driver's mouse pipeline.
      // Either the pending state (disabled Save) or an immediate close on a
      // fast round trip counts — both prove the tap was acknowledged without
      // waiting; the dialog closing is itself the fast-path confirmation.
      const start = Date.now();
      const save = page.getByRole("button", { name: "Save" });
      await save.dispatchEvent("click");
      await expect
        .poll(
          async () => {
            if ((await page.getByLabel("Title").count()) === 0) return "closed";
            if (await save.isDisabled()) return "disabled";
            return "waiting";
          },
          { timeout: 10_000 },
        )
        .not.toBe("waiting");
      const confirmMs = Date.now() - start;
      await expect(page.getByLabel("Title")).toBeHidden({ timeout: 10_000 });
      // Reflect: the row carries the new name (server-confirmed).
      await expect(sidebar(page).getByRole("link", { name: next })).toBeVisible({ timeout: 30_000 });
      if (i >= 0) {
        samples.rename?.confirm.push(confirmMs);
        samples.rename?.reflect.push(Date.now() - start);
      }
      title = next;
    }
    const summary = summarize(samples.rename as Samples);
    expect(summary.confirmP95).toBeLessThan(CONFIRM_P95_BUDGET_MS);
    expect(summary.p95).toBeLessThan(REFLECT_P95_BUDGET_MS);
  });

  test("archive: 15 runs (toggle back and forth)", async () => {
    test.setTimeout(600_000);
    // Show archived inline so the row stays addressable in both states.
    // Archived rows hide behind this toggle by default.
    await sidebar(page)
      .getByRole("button", { name: /Show archived threads/ })
      .click();
    let archived = false;
    for (let i = -1; i < RUNS_PER_ACTION; i++) {
      const action = archived ? "Unarchive" : "Archive";
      const row = sidebar(page).getByRole("link", { name: title });
      await row.hover();
      // Confirm and reflect coincide pre-optimism (R3.5, web-owned): the row
      // action flips only after the server roundtrip + live ops.
      const start = Date.now();
      await sidebar(page)
        .getByRole("button", { name: `${action} ${title}` })
        .dispatchEvent("click");
      const flipped = archived ? "Archive" : "Unarchive";
      // Reflect: ...and the flip is server-confirmed.
      await expect(sidebar(page).getByRole("button", { name: `${flipped} ${title}` })).toBeVisible({
        timeout: 30_000,
      });
      const elapsed = Date.now() - start;
      if (i >= 0) {
        samples.archive?.confirm.push(elapsed);
        samples.archive?.reflect.push(elapsed);
      }
      archived = !archived;
    }
    const summary = summarize(samples.archive as Samples);
    expect(summary.confirmP95).toBeLessThan(CONFIRM_P95_BUDGET_MS);
    expect(summary.p95).toBeLessThan(REFLECT_P95_BUDGET_MS);
  });
});
