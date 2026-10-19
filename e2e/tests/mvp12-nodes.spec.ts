import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createRestartableServer, type RestartableServer } from "../restartable-server";

const NODE_NAME = "Node B";
const THREAD = "hello from node B";
const FORTY_TWO = /(^|\s)42(\s|$)/;
const sidebar = (page: Page) => page.getByRole("complementary").or(page.getByLabel("Projects and threads"));
const conversation = (page: Page) => page.getByTestId("conversation");
const terminal = (page: Page) => page.getByRole("region", { name: "Terminal" });
const tokenOf = (server: RestartableServer) => readFileSync(join(server.home, "token"), "utf8").trim();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

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

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

async function mintNodeCode(port: number, token: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/api/pair?kind=node`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { shortCode: string }).shortCode;
}

test.describe.configure({ mode: "serial" });

test.describe("MVP12 Stage 2: two real servers linked on loopback", () => {
  let hub: RestartableServer;
  let node: RestartableServer;
  let hubPort: number;
  let nodePort: number;
  let page: Page;
  const groupOfNode = () => sidebar(page).getByRole("group", { name: NODE_NAME });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    hubPort = await freePort();
    nodePort = await freePort();
    hub = createRestartableServer({ port: hubPort });
    node = createRestartableServer({ port: nodePort });
    await hub.start();
    await node.start();
    const own = await browser.newPage();
    await own.goto(`http://127.0.0.1:${nodePort}/?token=${encodeURIComponent(tokenOf(node))}`);
    await completeSetup(own);
    await send(own, THREAD);
    await expect(sidebar(own).getByRole("link", { name: /hello from node B/ })).toBeVisible();
    await expect(conversation(own).getByText(THREAD, { exact: true }).first()).toBeVisible();
    await own.close();
    page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${hubPort}/?token=${encodeURIComponent(tokenOf(hub))}`);
    await completeSetup(page);
  });

  test.afterAll(async () => {
    await page?.close();
    await node?.stop().catch(() => undefined);
    await hub?.stop().catch(() => undefined);
    for (const server of [node, hub]) if (server) rmSync(server.home, { recursive: true, force: true });
  });

  test("tau connect links the node; its thread shows under its group and opens through the hub", async () => {
    const code = await mintNodeCode(hubPort, tokenOf(hub));
    const out = await node.tau(
      "connect",
      "--hub",
      `http://127.0.0.1:${hubPort}`,
      code,
      "--name",
      NODE_NAME,
      "--yes",
    );
    expect(out).toContain("Linked to");
    await expect(groupOfNode()).toBeVisible({ timeout: 30_000 });
    await expect(groupOfNode().getByRole("img", { name: "Online" }).first()).toBeVisible();
    const link = groupOfNode().getByRole("link", { name: /hello from node B/ });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/n\/[^/]+\/p\/[^/]+\/c\/[^/]+$/);
    await expect(conversation(page).getByText(THREAD, { exact: true }).first()).toBeVisible();
  });

  test("a new thread on the node's project, started from the hub, gets the faux answer", async () => {
    await page.getByRole("button", { name: "New thread", exact: true }).click();
    await page.getByRole("combobox", { name: "Project" }).click();
    const nodeModels = page.waitForResponse(/\/api\/n\/[^/]+\/api\/models$/);
    await page.getByRole("option", { name: "Home" }).nth(1).click();
    await expect(page).toHaveURL(/node=/);
    await nodeModels;
    const send = page.getByRole("button", { name: "Send", exact: true });
    await expect(async () => {
      await page.getByRole("textbox", { name: "Message" }).fill("via the hub");
      await expect(send).toBeEnabled({ timeout: 1000 });
    }).toPass();
    await send.click();
    await expect(page).toHaveURL(/\/n\/[^/]+\/p\/[^/]+\/c\/[^/]+$/);
    await expect(
      conversation(page)
        .getByText(/scripted reply from the faux model/)
        .first(),
    ).toBeVisible({
      timeout: 20_000,
    });
  });

  test("a terminal opened through the hub runs on the node", async () => {
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(page).toHaveURL(/\/n\/[^/]+\/.*\/terminal\/[^/]+$/);
    await terminal(page).locator("textarea").focus();
    await page.keyboard.type("echo $((6*7))");
    await page.keyboard.press("Enter");
    await expect(terminal(page)).toContainText(FORTY_TWO);
  });

  test("killing the node greys it within about 50 s and restarting brings it back", async () => {
    test.setTimeout(150_000);
    await node.stop();
    await expect(groupOfNode().getByRole("img", { name: "Offline" }).first()).toBeVisible({
      timeout: 55_000,
    });
    await expect(groupOfNode().locator("[data-stale]")).toBeVisible();
    await node.start();
    await expect(groupOfNode().getByRole("img", { name: "Online" }).first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test("an offline node still shows its titles after the hub restarts", async () => {
    test.setTimeout(150_000);
    await expect
      .poll(
        async () =>
          (
            await fetch(`http://127.0.0.1:${hubPort}/api/nodes`, {
              headers: { authorization: `Bearer ${tokenOf(hub)}` },
            })
          ).status,
      )
      .toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await node.stop();
    await hub.restart();
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(`http://127.0.0.1:${hubPort}/?token=${encodeURIComponent(tokenOf(hub))}`);
    await expect(groupOfNode().locator("[data-stale]")).toBeVisible({ timeout: 30_000 });
    await expect(groupOfNode().getByRole("link", { name: /hello from node B/ })).toBeVisible();
    await node.start();
    await expect(groupOfNode().getByRole("img", { name: "Online" }).first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test("revoking the node closes its proxied streams", async () => {
    const nodeId = await page.evaluate(async () => {
      const list = (await (await fetch("/api/nodes")).json()) as Array<{ id: string }>;
      return list[0]?.id ?? "";
    });
    expect(nodeId).not.toBe("");
    await page.evaluate((id) => {
      const socket = new WebSocket(`ws://${location.host}/api/n/${id}/api/live`);
      (window as unknown as { probe: WebSocket }).probe = socket;
      return new Promise<void>((resolve) => {
        socket.onopen = () => resolve();
      });
    }, nodeId);
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("navigation", { name: "Settings sections" }).getByText("Nodes").click();
    await settings.getByRole("button", { name: `Disconnect ${NODE_NAME}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { probe: WebSocket }).probe.readyState))
      .toBe(WebSocket.CLOSED);
    await page.keyboard.press("Escape");
    await expect(sidebar(page).getByRole("group", { name: NODE_NAME })).toHaveCount(0);
  });
});
