import { expect, test } from "@playwright/test";
import { ALL, bashThread, OFF, type ResourceServer, startResourceServer } from "../resources-support";

const heavy = (marker: string, seconds: number) =>
  `cargo test --${marker} 2>/dev/null; sleep ${seconds}; echo ${marker}-done`;
const MARKERS = ["h1", "h2", "h3", "h4"];
const replies = Object.fromEntries([
  ...MARKERS.map((marker) => [`live ${marker}`, bashThread(heavy(marker, 5))] as const),
  ["live timeout", bashThread(heavy("tmo", 2), 3)] as const,
  ["live slow", bashThread("sleep 10; echo slow-done", 3)] as const,
]);

let remote: ResourceServer;
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  remote = await startResourceServer({ replies });
});
test.afterAll(async () => remote?.stop());

test("governed threads all run to the end: nothing queues", async () => {
  await remote.setResources(ALL("background"));
  const ids: string[] = [];
  for (const marker of MARKERS) ids.push(await remote.start(`live ${marker}`));
  for (const id of ids) await remote.waitIdle(id, 120);
  for (const id of ids) expect((await remote.toolOutputs(id)).join("")).toContain("-done");
  await remote.setResources({ ...OFF });
});

test("the timeout counts run time, not anything else", async () => {
  await remote.setResources(ALL("background"));
  const id = await remote.start("live timeout");
  await remote.waitIdle(id, 60);
  expect((await remote.toolOutputs(id)).join("\n")).toContain("tmo-done");
  await remote.setResources({ ...OFF });
});

test("a slow command times out and the message names the scope", async () => {
  await remote.setResources(ALL("background"));
  const id = await remote.start("live slow", { mode: "checkout" });
  await remote.waitIdle(id, 60);
  const output = (await remote.toolOutputs(id)).join("\n");
  console.log(`LIVE timeout under Background: ${output}`);
  expect(output).toContain("Command timed out after 3 seconds");
  expect(output).toContain("Main threads run at Background");
  await remote.setResources({ ...OFF });
});
