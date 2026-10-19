import { rmSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  connect,
  conversation,
  freePort,
  groupOf,
  runInTerminal,
  type Served,
  served,
  setUpWithThread,
} from "../nodes-support";
import { createRestartableServer, type RestartableServer } from "../restartable-server";

/** MVP13 Step 2: three real built servers on scratch homes and random loopback ports, A-B and B-C linked. */
interface Row {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly hops: number;
  readonly via: string | null;
  readonly threads: number;
}

test.describe.configure({ mode: "serial" });

test.describe("MVP13 Step 2: a group of three nodes (A - B - C)", () => {
  test.setTimeout(240_000);
  const running: RestartableServer[] = [];
  let a: Served;
  let b: Served;
  let c: Served;
  let pageA: Page;

  async function startNode(name: string): Promise<Served> {
    const port = await freePort();
    const server = createRestartableServer({ port, env: { TAU_NODE_NAME: name } });
    running.push(server);
    await server.start();
    return served(server, port);
  }

  const rows = (node: Served) => node.server.json<Row[]>("nodes", "list");
  const rowOf = async (node: Served, id: string) => (await rows(node)).find((row) => row.id === id);
  const idOf = async (node: Served) => (await node.server.json<{ nodeId: string }>("nodes", "self")).nodeId;
  let idC = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(200_000);
    a = await startNode("Node A");
    b = await startNode("Node B");
    c = await startNode("Node C");
    pageA = await setUpWithThread(browser, a, "hello from node A");
    const pageB = await setUpWithThread(browser, b, "hello from node B");
    const pageC = await setUpWithThread(browser, c, "hello from node C");
    await pageB.close();
    await pageC.close();
    idC = await idOf(c);
  });

  test.afterAll(async () => {
    await pageA?.close();
    for (const server of running) {
      await server.stop().catch(() => undefined);
      rmSync(server.home, { recursive: true, force: true });
    }
  });

  test("A links B, C links B: A sees C at 2 hops via B within 20 s", async () => {
    await connect(a, b, "Node B");
    await connect(c, b, "Node B");
    await expect
      .poll(async () => await rowOf(a, idC), { timeout: 20_000, intervals: [500] })
      .toMatchObject({ name: "Node C", hops: 2, via: "Node B", status: "online" });
    // C's announce carries its thread count, so A shows C's one thread although it has no summary of C.
    await expect
      .poll(async () => (await rowOf(a, idC))?.threads, { timeout: 20_000, intervals: [500] })
      .toBe(1);
  });

  test("A opens a thread of C and a terminal on C, through B", async () => {
    await expect(groupOf(pageA, "Node C")).toBeVisible({ timeout: 30_000 });
    await groupOf(pageA, "Node C")
      .getByRole("link", { name: /hello from node C/ })
      .click();
    await expect(pageA).toHaveURL(/\/n\/[^/]+\/p\/[^/]+\/c\/[^/]+$/);
    await expect(conversation(pageA).getByText("hello from node C", { exact: true }).first()).toBeVisible();
    await runInTerminal(pageA);
  });

  test("B going down makes C unreachable from A; B back makes it reachable again", async () => {
    await b.server.stop();
    await expect
      .poll(async () => (await rowOf(a, idC))?.status ?? "gone", { timeout: 60_000, intervals: [1000] })
      .not.toBe("online");
    await b.server.start();
    await expect
      .poll(async () => (await rowOf(a, idC))?.status, { timeout: 90_000, intervals: [1000] })
      .toBe("online");
  });

  test("removing C from A cuts C off on every node", async () => {
    const out = await a.server.tau("nodes", "remove", idC, "--confirm", "Node C");
    expect(out.length).toBeGreaterThan(0);
    await expect.poll(async () => await rowOf(a, idC), { timeout: 15_000 }).toBeUndefined();
    await expect.poll(async () => await rowOf(b, idC), { timeout: 15_000 }).toBeUndefined();
    await expect
      .poll(async () => (await c.server.json<{ removed?: unknown }>("nodes", "self")).removed, {
        timeout: 15_000,
      })
      .toBeTruthy();
    await expect.poll(async () => (await rows(c)).length, { timeout: 15_000 }).toBe(0);
    await expect(groupOf(pageA, "Node C")).toHaveCount(0, { timeout: 30_000 });
  });
});
