import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, expect, type Page, request, test } from "@playwright/test";

const CLI = join(fileURLToPath(new URL("../..", import.meta.url)), "packages/cli/dist/bin.js");
const PROMPTS = ["heavy one", "heavy two", "heavy three"] as const;
const HEAVY = "cargo test --nothing 2>/dev/null; sleep 6; echo done";

const replies = Object.fromEntries(
  PROMPTS.map((prompt) => [
    prompt,
    [{ tools: [{ name: "bash", arguments: { command: HEAVY } }] }, { text: "finished" }],
  ]),
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

interface Activity {
  holders: { entryId: string }[];
  waiting: { entryId: string }[];
}

test.describe.configure({ mode: "serial" });

test.describe("resource control in the browser", () => {
  let root: string;
  let child: ChildProcess;
  let url: string;
  let api: APIRequestContext;
  let page: Page;
  let projectId: string;
  const threads: string[] = [];

  const activity = async () => (await (await api.get("/api/settings/resources/activity")).json()) as Activity;
  const waitActivity = async (check: (value: Activity) => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (check(await activity())) return;
      await sleep(200);
    }
    throw new Error(`activity never matched: ${JSON.stringify(await activity())}`);
  };

  test.beforeAll(async ({ browser }) => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "tau-res-")));
    const repo = join(root, "code");
    mkdirSync(repo);
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: repo,
        stdio: "ignore",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "E",
          GIT_AUTHOR_EMAIL: "e@e.io",
          GIT_COMMITTER_NAME: "E",
          GIT_COMMITTER_EMAIL: "e@e.io",
        },
      });
    git("init", "-q", "-b", "main");
    writeFileSync(join(repo, "README.md"), "# res\n");
    git("add", ".");
    git("commit", "-q", "-m", "first");
    writeFileSync(join(root, "replies.json"), JSON.stringify(replies));
    const port = await freePort();
    const state = join(root, "state");
    mkdirSync(join(root, "home"));
    child = spawn(
      process.execPath,
      [CLI, "serve", "--faux", "--no-open", "--port", String(port), "--home", state],
      {
        env: {
          ...process.env,
          HOME: join(root, "home"),
          TAU_FAUX_REPLIES: join(root, "replies.json"),
          TAU_FAKE_CLAUDE_CLI: "1",
        },
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
    url = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await fetch(url).then(
          () => true,
          () => false,
        )
      )
        break;
      await sleep(200);
    }
    const token = readFileSync(join(state, "token"), "utf8").trim();
    api = await request.newContext({ baseURL: url, extraHTTPHeaders: { origin: url } });
    await api.get(`/?token=${encodeURIComponent(token)}`);
    await api.put("/api/providers/openrouter/key", { data: { key: "sk-or-v1-faux" } });
    await api.put("/api/settings/default-model", { data: { provider: "faux", modelId: "faux-1" } });
    projectId = ((await (await api.post("/api/projects", { data: { path: repo } })).json()) as { id: string })
      .id;
    page = await browser.newPage({ baseURL: url, storageState: await api.storageState() });
  });

  test.afterAll(async () => {
    await page.close();
    await api.dispose();
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
    rmSync(root, { recursive: true, force: true });
  });

  test("Off: a heavy command runs at once and the panel lists nothing", async () => {
    await page.goto("/");
    const response = await api.post("/api/conversations", {
      data: { projectId, text: PROMPTS[0], requestId: "off-1" },
    });
    threads.push(((await response.json()) as { id: string }).id);
    await sleep(1500);
    expect(await activity()).toEqual({ holders: [], waiting: [] });
  });

  test("the Agent settings set one heavy slot and apply to worktree threads", async () => {
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByRole("navigation", { name: "Settings sections" }).getByText("Agent").click();
    await expect(dialog.getByText("Heavy command slots")).toBeVisible();
    await dialog.getByRole("switch", { name: "Limit: Heavy command slots" }).click();
    const slots = dialog.getByRole("spinbutton", { name: /Heavy command slots/ });
    await slots.fill("1");
    await slots.press("Enter");
    await expect
      .poll(async () => ((await (await api.get("/api/settings")).json()) as any).resources?.heavySlots)
      .toBe(1);
    await dialog.getByRole("checkbox", { name: /Worktree threads/ }).click();
    await expect
      .poll(async () => ((await (await api.get("/api/settings")).json()) as any).resources)
      .toMatchObject({
        heavySlots: 1,
        appliesTo: { worktrees: true },
      });
    await page.screenshot({ path: join(root, "settings.png") });
  });

  test("three threads: one holds the slot, two queue, Stop cancels a queued one", async () => {
    await sleep(7000); // let the Off-path thread from the first test finish
    for (const [index, prompt] of PROMPTS.entries()) {
      const response = await api.post("/api/conversations", {
        data: { projectId, text: prompt, requestId: `gov-${index}` },
      });
      threads.push(((await response.json()) as { id: string }).id);
    }
    await waitActivity((value) => value.holders.length === 1 && value.waiting.length === 2);
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog.getByRole("button", { name: /^Stop cargo test/ })).toHaveCount(3, {
      timeout: 10_000,
    });
    await page.screenshot({ path: "/tmp/res-queue-shot.png" });
    await dialog
      .getByRole("button", { name: /^Stop cargo test/ })
      .nth(2)
      .click();
    await waitActivity((value) => value.holders.length === 1 && value.waiting.length === 1);
  });

  test("the queue drains and every thread ends", async () => {
    await waitActivity((value) => value.holders.length === 0 && value.waiting.length === 0);
    for (const id of threads) {
      await expect
        .poll(
          async () => {
            const all = (await (await api.get("/api/conversations")).json()) as {
              id: string;
              status: string;
            }[];
            return all.find((thread) => thread.id === id)?.status;
          },
          { timeout: 30_000 },
        )
        .not.toBe("running");
    }
  });
});
