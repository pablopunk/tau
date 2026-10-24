import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { demoRepository, PORT, tokenFile, waitForConversationRunEnd } from "../support";

const COMMIT = "bash git add -A && git -c user.name=e2e -c user.email=e2e@example.com commit -q -m note";

const ORIGIN = { Origin: `http://127.0.0.1:${PORT}` };
const readToken = () => readFileSync(tokenFile(), "utf8").trim();
const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message" });
const doneMarks = (page: Page) => page.getByText("Done.", { exact: true });
const conversationIdOf = (page: Page) => new URL(page.url()).pathname.split("/").pop() ?? "";

async function send(page: Page, text: string) {
  await messageBox(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

async function sendAndWaitForDone(page: Page, text: string, doneCount: number) {
  await send(page, text);
  await expect(doneMarks(page)).toHaveCount(doneCount, { timeout: 20_000 });
}

async function openNewThread(page: Page) {
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();
}

async function startThreadInDemoRepository(page: Page, text: string) {
  await openNewThread(page);
  await page.getByRole("combobox", { name: "Project" }).click();
  await page.getByRole("option", { name: /demo-repo/ }).click();
  await expect(page.getByRole("radio", { name: "Worktree" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Worktree" })).toBeChecked();
  await send(page, text);
  await expect(page).toHaveURL(/\/c\//);
  await expect(doneMarks(page)).toHaveCount(1, { timeout: 20_000 });
}

async function workspacePathOf(page: Page): Promise<string> {
  const response = await page.request.get("/api/conversations");
  const threads = (await response.json()) as { id: string; workspace: { path: string } }[];
  const thread = threads.find((candidate) => candidate.id === conversationIdOf(page));
  return thread?.workspace.path ?? "";
}

const readFileInThread = async (page: Page, name: string) =>
  readFileSync(join(await workspacePathOf(page), name), "utf8");

function menuOfMessage(page: Page, text: string) {
  return page
    .locator(".group", { has: page.getByText(text, { exact: true }) })
    .last()
    .getByRole("button", { name: "Message actions" });
}

async function openSettingsSection(page: Page, section: string) {
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: section })
    .click();
}

test.describe.configure({ mode: "serial" });

test.describe("MVP5", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(`/?token=${encodeURIComponent(readToken())}`);
    await expect(page.getByRole("heading", { name: "New thread" })).toBeVisible();
    const added = await page.request.post("/api/projects", {
      data: { path: demoRepository() },
      headers: ORIGIN,
    });
    // a serial retry re-runs beforeAll: the project is already added
    expect(added.ok() || added.status() === 409).toBe(true);
    await page.reload();
  });

  test.afterAll(async () => {
    // the queue test flips the shared server's message mode; never leak it into later specs
    await page.request.put("/api/settings/message-mode", { data: { mode: "steer" }, headers: ORIGIN });
    await page.close();
  });

  test("a worktree thread edits a file, commits it and merges into main", async () => {
    // Unique per run: a serial retry re-runs against the same repo, and a
    // fixed filename would already be committed (empty second commit fails).
    const note = `note-${Date.now().toString(36)}.txt`;
    await startThreadInDemoRepository(page, `write ${note} hello`);
    // The header chip hides while the conversation sidebar is open (open by default).
    const closeSidebar = page.getByRole("button", { name: "Close conversation sidebar" });
    if ((await closeSidebar.count()) > 0) await closeSidebar.click();
    const chip = page.getByRole("button", { name: "Workspace" });
    await expect(chip).toContainText("pi/");
    await sendAndWaitForDone(page, COMMIT, 2);
    await expect(chip.getByRole("img", { name: "1 ahead" })).toBeVisible();
    await chip.click();
    await page.getByRole("menuitem", { name: /Merge into main/ }).click();
    await expect(chip).toContainText("merged");
    await expect
      .poll(() => readFileSync(join(demoRepository(), note), "utf8"), { timeout: 10_000 })
      .toBe("hello");
  });

  test("rewind restores a file and offers Rewind to start on the first message", async () => {
    await startThreadInDemoRepository(page, "write a.txt one");
    await sendAndWaitForDone(page, "write a.txt two", 2);
    expect(await readFileInThread(page, "a.txt")).toBe("two");
    const original = conversationIdOf(page);
    await menuOfMessage(page, "write a.txt two").click();
    await page.getByRole("menuitem", { name: "Rewind to here" }).click();
    await page.getByRole("button", { name: "Rewind", exact: true }).click();
    await expect.poll(() => conversationIdOf(page)).not.toBe(original);
    await expect(messageBox(page)).toHaveValue("write a.txt two");
    expect(await readFileInThread(page, "a.txt")).toBe("one");
    await menuOfMessage(page, "write a.txt one").click();
    await expect(page.getByRole("menuitem", { name: "Rewind to start" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("fork opens a new thread named after the source", async () => {
    const source = conversationIdOf(page);
    await page.getByRole("button", { name: "Message actions" }).last().click();
    await page.getByRole("menuitem", { name: "Fork from here" }).click();
    await expect.poll(() => conversationIdOf(page)).not.toBe(source);
    await expect(page.getByRole("link", { name: /Fork of/ }).first()).toBeVisible();
  });

  test("queue mode holds a message while the agent works, and cancel drops it", async () => {
    await openSettingsSection(page, "Agent");
    await page.getByRole("radio", { name: "Queue" }).click();
    await page.keyboard.press("Escape");
    await openNewThread(page);
    await send(page, "bash sleep 6");
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await messageBox(page).fill("later message");
    await messageBox(page).press("Enter");
    const queued = page.getByRole("list", { name: "Queued messages" });
    await expect(queued).toContainText("later message");
    await queued.getByRole("button", { name: "Cancel" }).click();
    await expect(queued).toBeHidden();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden({ timeout: 20_000 });
  });

  test("the todo panel shows the agent's list", async () => {
    await openNewThread(page);
    await send(page, "todo write tests | ship it");
    const panel = page.getByTestId("todo-panel");
    await expect(panel).toContainText("Todos");
    await expect(panel).toContainText("0/2");
    await expect(panel).toContainText("write tests");
  });

  test("the processes sheet lists a background process and stops it", async () => {
    test.setTimeout(60_000);
    await openNewThread(page);
    await send(page, "bg sleep 300");
    await waitForConversationRunEnd(page);
    // Load the persisted process list after the tool run has finished.
    await page.reload();
    const chip = page.getByRole("button", { name: "1 running processes" });
    await expect(chip).toBeVisible({ timeout: 20_000 });
    // Since collapsed indicators reveal the sidebar, the chip opens the
    // processes section there instead of a dialog.
    await chip.click();
    const sidebar = page.getByRole("complementary", { name: "Conversation details" });
    // The row shows the command twice (name <span> and command <code>).
    await expect(sidebar.getByText("sleep 300").first()).toBeVisible();
    await sidebar.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(sidebar.getByRole("button", { name: "Stop", exact: true })).toBeHidden({ timeout: 20_000 });
  });

  test("a subagent child shows in the sidebar and opens read-only", async () => {
    await openNewThread(page);
    await send(page, "agent investigate");
    const child = page.getByRole("link", { name: /^(New activity )?investigate$/ });
    await expect(child).toBeVisible({ timeout: 20_000 });
    await child.click();
    await expect(page.getByText("Subagent of")).toBeVisible();
    await expect(messageBox(page)).toHaveCount(0);
  });

  test("Settings has Agent and Tools sections", async () => {
    await openSettingsSection(page, "Agent");
    await expect(page.getByText("While the agent works, new messages")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Steer" })).toBeChecked();
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Tools" })
      .click();
    await expect(page.getByRole("heading", { name: "MCP servers" })).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
