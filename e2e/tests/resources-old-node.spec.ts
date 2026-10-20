import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { expect, type Page, test } from "@playwright/test";
import {
  connect,
  freePort,
  listNodes,
  type Served,
  served,
  setUpWithThread,
} from "../nodes-support";
import { createRestartableServer, type RestartableServer } from "../restartable-server";

const OLD_TAU = process.env.TAU_OLD_NODE ?? join(homedir(), ".local/share/tau/versions/0.5.3/tau");

test.skip(!existsSync(OLD_TAU), "no older tau release installed");
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const running: RestartableServer[] = [];
let current: Served;
let old: Served;
let page: Page;

async function startNode(command?: { file: string; args: string[] }): Promise<Served> {
  const port = await freePort();
  const stubs = realpathSync(mkdtempSync(join(tmpdir(), "tau-old-stubs-")));
  for (const name of ["launchctl", "systemctl"]) {
    writeFileSync(join(stubs, name), "#!/bin/sh\nexit 1\n");
    chmodSync(join(stubs, name), 0o755);
  }
  mkdirSync(stubs, { recursive: true });
  const server = createRestartableServer({
    port,
    command,
    env: { PATH: `${stubs}:${process.env.PATH ?? ""}` },
  });
  running.push(server);
  await server.start();
  return served(server, port);
}

test.beforeAll(async ({ browser }) => {
  current = await startNode();
  old = await startNode({ file: OLD_TAU, args: [] });
  page = await setUpWithThread(browser, current, "hello from current");
});

test.afterAll(async () => {
  await page?.close();
  for (const server of running) {
    await server.stop().catch(() => undefined);
    rmSync(server.home, { recursive: true, force: true });
  }
});

test("an older node's Resources never crash the new web: it says the node needs an update", async () => {
  await connect(old, current, "Old node");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("navigation", { name: "Settings sections" }).getByText("Agent").click();
  await dialog.getByRole("button", { name: "Old node" }).click();
  const notice = dialog.getByText(/needs a tau update|This node needs an update/).first();
  await expect(notice).toBeVisible({ timeout: 30_000 });
  console.log(`OLD NODE settings notice: ${await notice.innerText()}`);
  console.log(`OLD NODE nodes: ${JSON.stringify((await listNodes(current.server)).map((node) => node.status))}`);
  await expect(dialog.getByText("Command priority")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/old-node-settings.png" });
  expect(errors).toEqual([]);
  await expect(dialog).toBeVisible();
});
