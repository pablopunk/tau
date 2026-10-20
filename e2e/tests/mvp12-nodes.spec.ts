import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  closeSettings,
  connect,
  conversation,
  disconnectInUi,
  freePort,
  groupOf,
  listNodes,
  mintNodeCode,
  newThreadOnPeer,
  nodeDevices,
  nodeRow,
  openNodesPage,
  runInTerminal,
  type Served,
  served,
  setUpWithThread,
  sidebar,
} from "../nodes-support";
import { createRestartableServer, type RestartableServer } from "../restartable-server";

/** MVP13 Step 1: two (and a few more) real built servers on scratch homes and random loopback ports. */
const THREAD_A = "hello from node A";
const THREAD_B = "hello from node B";
const ONLINE = { name: "Online" } as const;
const OFFLINE = { name: "Offline" } as const;

test.describe.configure({ mode: "serial" });

test.describe("MVP13 Step 1: symmetric links between real servers", () => {
  test.setTimeout(180_000);
  const running: RestartableServer[] = [];
  let a: Served;
  let b: Served;
  let pageA: Page;
  let pageB: Page;

  async function startNode(env: Record<string, string> = {}): Promise<Served> {
    const port = await freePort();
    const server = createRestartableServer({ port, env });
    running.push(server);
    await server.start();
    return served(server, port);
  }

  const online = (page: Page, name: string) => expect(groupOf(page, name).getByRole("img", ONLINE).first());

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(150_000);
    a = await startNode();
    b = await startNode();
    pageA = await setUpWithThread(browser, a, THREAD_A);
    pageB = await setUpWithThread(browser, b, THREAD_B);
  });

  test.afterAll(async () => {
    await pageA?.close();
    await pageB?.close();
    for (const server of running) {
      await server.stop().catch(() => undefined);
      rmSync(server.home, { recursive: true, force: true });
    }
  });

  test("tau connect --node from B: A sees B and B sees A (sidebar and Nodes page)", async () => {
    await connect(b, a, "Node B");
    const [peerOfB] = await listNodes(b.server);
    await b.server.tau("nodes", "rename", peerOfB?.id ?? "", "Node A");
    await online(pageA, "Node B").toBeVisible({ timeout: 30_000 });
    await online(pageB, "Node A").toBeVisible({ timeout: 30_000 });
    expect(await listNodes(a.server)).toHaveLength(1);
    expect(await listNodes(b.server)).toHaveLength(1);

    const onA = await openNodesPage(pageA);
    await expect(nodeRow(onA, "Node B")).toContainText("It connected to this node: Linked");
    await closeSettings(pageA);
    const onB = await openNodesPage(pageB);
    await expect(nodeRow(onB, "Node A")).toContainText("This node connected to it: Linked");
    await closeSettings(pageB);
  });

  test("each side opens the other's thread", async () => {
    await groupOf(pageA, "Node B")
      .getByRole("link", { name: /hello from node B/ })
      .click();
    await expect(pageA).toHaveURL(/\/n\/[^/]+\/p\/[^/]+\/c\/[^/]+$/);
    await expect(conversation(pageA).getByText(THREAD_B, { exact: true }).first()).toBeVisible();
    await groupOf(pageB, "Node A")
      .getByRole("link", { name: /hello from node A/ })
      .click();
    await expect(pageB).toHaveURL(/\/n\/[^/]+\/p\/[^/]+\/c\/[^/]+$/);
    await expect(conversation(pageB).getByText(THREAD_A, { exact: true }).first()).toBeVisible();
  });

  test("a new thread on the other node, started from either side, gets the faux answer", async () => {
    await newThreadOnPeer(pageA, "from A to B");
    await newThreadOnPeer(pageB, "from B to A");
  });

  test("a terminal opened from either side runs on the other node", async () => {
    await runInTerminal(pageA);
    await runInTerminal(pageB);
  });

  test("killing B greys it on A within about 50 s; restarting brings it back on both", async () => {
    await b.server.stop();
    await expect(groupOf(pageA, "Node B").getByRole("img", OFFLINE).first()).toBeVisible({ timeout: 55_000 });
    await expect(groupOf(pageA, "Node B").locator("[data-stale]")).toBeVisible();
    await b.server.start();
    await online(pageA, "Node B").toBeVisible({ timeout: 60_000 });
    await pageB.goto(b.signedIn);
    await online(pageB, "Node A").toBeVisible({ timeout: 60_000 });
  });

  test("a node on another protocol stays linked and shows 'update required' on both sides", async () => {
    await b.server.stop();
    b.server.setEnv({ TAU_FAKE_PROTOCOL_VERSION: "0".repeat(32) });
    await b.server.start();
    await expect(async () => {
      const onA = await openNodesPage(pageA);
      await expect(nodeRow(onA, "Node B")).toContainText("Update tau on Node B", { timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await closeSettings(pageA);
    await pageB.goto(b.signedIn);
    await expect(async () => {
      const onB = await openNodesPage(pageB);
      await expect(nodeRow(onB, "Node A")).toContainText("Update tau on Node A", { timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await closeSettings(pageB);
    await b.server.stop();
    b.server.setEnv({ TAU_FAKE_PROTOCOL_VERSION: "" });
    await b.server.start();
    await online(pageA, "Node B").toBeVisible({ timeout: 60_000 });
  });

  test("disconnect from A's side: both forget each other, no device is left, streams close", async () => {
    const nodeId = (await listNodes(a.server))[0]?.id ?? "";
    expect(nodeId).not.toBe("");
    await pageA.evaluate((id) => {
      const socket = new WebSocket(`ws://${location.host}/api/n/${id}/api/live`);
      (window as unknown as { probe: WebSocket }).probe = socket;
      return new Promise<void>((resolve) => {
        socket.onopen = () => resolve();
      });
    }, nodeId);
    await disconnectInUi(pageA, "Node B");
    await expect
      .poll(() => pageA.evaluate(() => (window as unknown as { probe: WebSocket }).probe.readyState))
      .toBe(WebSocket.CLOSED);
    await expect(groupOf(pageA, "Node B")).toHaveCount(0);
    await expect.poll(async () => (await listNodes(a.server)).length).toBe(0);
    await expect.poll(async () => (await listNodes(b.server)).length, { timeout: 30_000 }).toBe(0);
    expect(await nodeDevices(a.server)).toHaveLength(0);
    expect(await nodeDevices(b.server)).toHaveLength(0);
    expect(existsSync(join(b.server.home, "peers.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(b.server.home, "peers.json"), "utf8"))).toEqual([]);
  });

  test("link again, then disconnect from B's side: A revokes the device, nothing is left", async () => {
    await connect(b, a, "Node B");
    await online(pageA, "Node B").toBeVisible({ timeout: 30_000 });
    expect(await nodeDevices(a.server)).toHaveLength(1);
    await pageB.goto(b.signedIn);
    const [peer] = await listNodes(b.server);
    await disconnectInUi(pageB, peer?.name ?? "");
    await expect.poll(async () => (await listNodes(b.server)).length).toBe(0);
    await expect.poll(async () => (await listNodes(a.server)).length, { timeout: 30_000 }).toBe(0);
    expect(await nodeDevices(a.server)).toHaveLength(0);
    await expect(groupOf(pageA, "Node B")).toHaveCount(0, { timeout: 30_000 });
  });

  test("glare: both nodes connect to each other at once: one link, no duplicate row, no orphan device", async () => {
    const [c, d] = [await startNode(), await startNode()];
    const [codeForD, codeForC] = [await mintNodeCode(d), await mintNodeCode(c)];
    await Promise.all([
      c.server.tau("connect", "--node", d.url, codeForD, "--name", "Node C", "--yes"),
      d.server.tau("connect", "--node", c.url, codeForC, "--name", "Node D", "--yes"),
    ]);
    for (const node of [c, d]) {
      await expect
        .poll(async () => (await listNodes(node.server)).map((listed) => listed.status), { timeout: 30_000 })
        .toEqual(["online"]);
    }
    const oneLinkEach = async (node: typeof c) => {
      const list = await listNodes(node.server);
      return (
        list.length === 1 && (list[0]?.links ?? []).filter((link) => link.state === "linked").length === 1
      );
    };
    await expect
      .poll(async () => [await oneLinkEach(c), await oneLinkEach(d)], { timeout: 30_000 })
      .toEqual([true, true]);
    for (const node of [c, d]) {
      const list = await listNodes(node.server);
      expect(list).toHaveLength(1);
      expect(list[0]?.status).toBe("online");
      expect((await nodeDevices(node.server)).length).toBeLessThanOrEqual(2);
    }
    const linked = (await Promise.all([c, d].map((node) => listNodes(node.server)))).flatMap((list) =>
      (list[0]?.links ?? []).filter((link) => link.state === "linked"),
    );
    expect(linked.length).toBeGreaterThanOrEqual(2);
    await c.server.stop();
    await d.server.stop();
  });

  test("a 0.1.x-shaped home (hub.json) migrates to peers.json and links; hub.json stays", async () => {
    const old = await startNode();
    await old.server.stop();
    await old.server.tau("connect", "--node", a.url, await mintNodeCode(a), "--name", "Node Old", "--yes");
    const peers = JSON.parse(readFileSync(join(old.server.home, "peers.json"), "utf8")) as Array<{
      url: string;
      secret: string;
      name: string;
    }>;
    const [peer] = peers;
    writeFileSync(
      join(old.server.home, "hub.json"),
      JSON.stringify({ hubUrl: peer?.url, nodeSecret: peer?.secret, name: "Hub", nodeName: "Node Old" }),
    );
    rmSync(join(old.server.home, "peers.json"));
    await old.server.start();
    await expect
      .poll(async () => (await listNodes(old.server)).map((n) => n.status), { timeout: 30_000 })
      .toEqual(["online"]);
    await expect
      .poll(async () => (await listNodes(a.server)).map((n) => n.name), { timeout: 30_000 })
      .toEqual(["Node Old"]);
    expect(existsSync(join(old.server.home, "hub.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(old.server.home, "peers.json"), "utf8"))).toHaveLength(1);
    expect(readFileSync(join(a.server.home, "devices.json"), "utf8")).toContain('"kind": "machine"');
    await old.server.stop();
  });

  test("onboarding: a node with no provider and a known peer offers 'Use my other nodes'; it is remembered on the server", async ({
    browser,
  }) => {
    for (const listed of await listNodes(a.server))
      await a.server.tau("nodes", "disconnect", listed.id, "--yes");
    const fresh = await startNode();
    await connect(fresh, a, "Node Fresh");
    const first = await browser.newContext();
    const page = await first.newPage();
    await page.goto(fresh.signedIn);
    await page.getByRole("button", { name: "Use my other nodes" }).click();
    await expect(sidebar(page).getByRole("link", { name: /hello from node A/ })).toBeVisible({
      timeout: 30_000,
    });
    const second = await browser.newContext();
    const again = await second.newPage();
    await again.goto(fresh.signedIn);
    await expect(sidebar(again).getByRole("link", { name: /hello from node A/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(again.getByRole("button", { name: "Use my other nodes" })).toHaveCount(0);
    await first.close();
    await second.close();
  });
});
