import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { type Browser, expect, type Page } from "@playwright/test";
import type { RestartableServer } from "./restartable-server";

export const FORTY_TWO = /(^|\s)42(\s|$)/;
export const sidebar = (page: Page) =>
  page.getByRole("complementary").or(page.getByLabel("Projects and threads"));
export const conversation = (page: Page) => page.getByTestId("conversation");
export const terminal = (page: Page) => page.getByRole("region", { name: "Terminal" });
export const tokenOf = (server: RestartableServer) => readFileSync(join(server.home, "token"), "utf8").trim();

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

export interface Served {
  readonly server: RestartableServer;
  readonly port: number;
  readonly url: string;
  /** The URL that signs a browser in as the owner. */
  readonly signedIn: string;
}

export const served = (server: RestartableServer, port: number): Served => ({
  server,
  port,
  url: `http://127.0.0.1:${port}`,
  signedIn: `http://127.0.0.1:${port}/?token=${encodeURIComponent(tokenOf(server))}`,
});

export async function completeSetup(page: Page) {
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

export async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

/** Sets a node up through its own UI and leaves one thread titled `thread` on it. Returns the page, signed in. */
export async function setUpWithThread(browser: Browser, node: Served, thread: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(node.signedIn);
  await completeSetup(page);
  await send(page, thread);
  await expect(sidebar(page).getByRole("link", { name: new RegExp(thread) })).toBeVisible();
  await expect(conversation(page).getByText(thread, { exact: true }).first()).toBeVisible();
  return page;
}

export async function mintNodeCode(node: Served): Promise<string> {
  const response = await fetch(`${node.url}/api/pair?kind=node`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenOf(node.server)}` },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { shortCode: string }).shortCode;
}

/** `tau connect --node <to> <code> --yes` run on `from`. */
export async function connect(from: Served, to: Served, name: string): Promise<string> {
  const out = await from.server.tau(
    "connect",
    "--node",
    to.url,
    await mintNodeCode(to),
    "--name",
    name,
    "--yes",
  );
  expect(out).toContain("Linked to");
  return out;
}

export interface ListedNode {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly links: ReadonlyArray<{ direction: string; state: string }>;
}
export const listNodes = (server: RestartableServer) => server.json<ListedNode[]>("nodes", "list");
interface ListedDevice {
  readonly kind: string;
}
export const nodeDevices = async (server: RestartableServer) =>
  (await server.json<ListedDevice[]>("devices", "list")).filter((device) => device.kind === "node");

export async function openNodesPage(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("navigation", { name: "Settings sections" }).getByText("Nodes").click();
  return settings;
}

export const groupOf = (page: Page, name: string) => sidebar(page).getByRole("group", { name });

/** The Node row of the Nodes page, by the node's name. */
export const nodeRow = (settings: ReturnType<Page["getByRole"]>, name: string) =>
  settings.locator("[data-node-id]").filter({ hasText: name });

export async function closeSettings(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(async () => {
    if (await dialog.isVisible()) await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 500 });
  }).toPass();
}

export async function disconnectInUi(page: Page, name: string) {
  const settings = await openNodesPage(page);
  await settings.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Disconnect" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await closeSettings(page);
}

/** Starts a new thread on the peer's project (the second "Home" in the picker) and waits for the faux answer. */
export async function newThreadOnPeer(page: Page, text: string) {
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await page.getByRole("combobox", { name: "Project" }).click();
  const peerModels = page.waitForResponse(/\/api\/n\/[^/]+\/api\/models$/);
  await page.getByRole("option", { name: "Home" }).nth(1).click();
  await expect(page).toHaveURL(/node=/);
  await peerModels;
  const sendButton = page.getByRole("button", { name: "Send", exact: true });
  await expect(async () => {
    await page.getByRole("textbox", { name: "Message" }).fill(text);
    await expect(sendButton).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await sendButton.click();
  await expect(page).toHaveURL(/\/n\/[^/]+\/p\/[^/]+\/c\/[^/]+$/);
  await expect(
    conversation(page)
      .getByText(/scripted reply from the faux model/)
      .first(),
  ).toBeVisible({
    timeout: 20_000,
  });
}

export async function runInTerminal(page: Page) {
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page).toHaveURL(/\/n\/[^/]+\/.*\/terminal\/[^/]+$/);
  await terminal(page).locator("textarea").focus();
  await page.keyboard.type("echo $((6*7))");
  await page.keyboard.press("Enter");
  await expect(terminal(page)).toContainText(FORTY_TWO);
}
