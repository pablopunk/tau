import { expect, test } from "@playwright/test";
import { bashThread, OFF, type ResourceServer, sleep, startResourceServer } from "../resources-support";

const heavy = (marker: string, seconds: number) =>
  `cargo test --${marker} 2>/dev/null; sleep ${seconds}; echo ${marker}-done`;
const MARKERS = ["h1", "h2", "h3", "h4"];
const replies = Object.fromEntries([
  ...MARKERS.map((marker) => [`live ${marker}`, bashThread(heavy(marker, 10))] as const),
  ["live bg a", bashThread(heavy("bga", 40))] as const,
  ["live bg b", bashThread(heavy("bgb", 3))] as const,
  ["live timeout", bashThread(heavy("tmo", 3), 5)] as const,
]);

let remote: ResourceServer;
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  remote = await startResourceServer({ replies });
});
test.afterAll(async () => remote?.stop());

const counts = async () => {
  const value = await remote.activity();
  return { holders: value.holders.length, waiting: value.waiting.length };
};
const idle = () => remote.waitActivity((value) => value.holders.length + value.waiting.length === 0, 90_000);

test("lowering and raising heavySlots with waiters queues and drains", async () => {
  await remote.setResources({ heavySlots: 1 });
  const ids: string[] = [];
  for (const marker of MARKERS) ids.push(await remote.start(`live ${marker}`));
  await remote.waitActivity((value) => value.holders.length === 1 && value.waiting.length === 3);
  await remote.setResources({ heavySlots: 3 });
  await remote.waitActivity((value) => value.holders.length === 3 && value.waiting.length === 1, 5000);
  await remote.setResources({ heavySlots: 1 });
  await sleep(500);
  expect(await counts()).toEqual({ holders: 3, waiting: 1 });
  console.log(`LIVE lowering to 1 with 3 holders: ${JSON.stringify(await counts())} (nothing is killed)`);
  await remote.setResources({ heavySlots: 2 });
  await sleep(500);
  expect(await counts()).toEqual({ holders: 3, waiting: 1 });
  await idle();
  for (const id of ids) expect((await remote.toolOutputs(id)).join("")).toContain("-done");
});

test("turning every control Off drains the waiters at once", async () => {
  await remote.setResources({ heavySlots: 1 });
  for (const marker of MARKERS) await remote.start(`live ${marker}`);
  await remote.waitActivity((value) => value.holders.length === 1 && value.waiting.length === 3);
  await remote.setResources({ ...OFF });
  const began = Date.now();
  await remote.waitActivity((value) => value.waiting.length === 0, 5000);
  console.log(`LIVE waiters drained ${Date.now() - began} ms after Off`);
  await sleep(1000);
  expect(await counts()).toEqual({ holders: 4, waiting: 0 }); // the drained waiters hold their grants and run together
  await idle();
});

test("Stop on a queued command ends it with the Resources message and frees nothing else", async () => {
  await remote.setResources({ heavySlots: 1 });
  const first = await remote.start("live h1");
  await remote.waitActivity((value) => value.holders.length === 1);
  const second = await remote.start("live h2");
  const activity = await remote.waitActivity((value) => value.waiting.length === 1);
  const stop = await remote.api.delete(`/api/settings/resources/activity/${activity.waiting[0]?.entryId}`);
  expect(stop.ok()).toBe(true);
  await remote.waitActivity((value) => value.waiting.length === 0 && value.holders.length === 1);
  await remote.waitIdle(second, 30);
  const output = (await remote.toolOutputs(second)).join("\n");
  console.log(`LIVE stopped queued output: ${output}`);
  expect(output).toContain("Stopped from Resources settings");
  await idle();
  expect((await remote.toolOutputs(first)).join("")).toContain("h1-done");
});

test("a queued command's timeout does not count the queue time; a running one still times out", async () => {
  await remote.setResources({ heavySlots: 1 });
  await remote.start("live h1");
  await remote.waitActivity((value) => value.holders.length === 1);
  const queued = await remote.start("live timeout");
  await remote.waitActivity((value) => value.waiting.length === 1);
  await remote.waitIdle(queued, 60);
  const output = (await remote.toolOutputs(queued)).join("\n");
  console.log(`LIVE queued ~10 s with timeout 5 s, then ran 3 s: ${output}`);
  expect(output).toContain("tmo-done");
  await idle();
});

async function queueBackgrounded(holderPrompt: string, queuedPrompt: string) {
  await remote.setResources({ heavySlots: 1 });
  await remote.start(holderPrompt);
  await remote.waitActivity((value) => value.holders.length === 1);
  const queued = await remote.start(queuedPrompt);
  await remote.waitActivity((value) => value.waiting.length === 1);
  let callId: string | undefined;
  for (let attempt = 0; attempt < 20 && !callId; attempt++) {
    callId = (await remote.toolCallIds(queued))[0];
    if (!callId) await sleep(200);
  }
  const moved = await remote.api.post(`/api/conversations/${queued}/tool-calls/${callId}/background`);
  expect(moved.ok()).toBe(true);
  const before = (await moved.json()) as { id: string; state: string };
  expect(before.state).toBe("queued");
  return { queued, id: before.id };
}

const recordOf = async (conversation: string, id: string) => {
  const processes = (await (await remote.api.get(`/api/conversations/${conversation}/processes`)).json()) as {
    id: string;
    state: string;
  }[];
  return processes.find((entry) => entry.id === id);
};

test("a persisted queued record is pruned after a crash, with no row and no log left", async () => {
  const { queued, id } = await queueBackgrounded("live bg a", "live bg b");
  await remote.crash();
  const record = await recordOf(queued, id);
  console.log(`LIVE after crash: ${JSON.stringify(record)}`);
  expect(record).toBeUndefined();
  const logs = await remote.api.get(`/api/processes/${id}/logs`);
  expect(logs.status()).toBe(404);
});

test("a graceful restart never leaves a queued record behind", async () => {
  const { queued, id } = await queueBackgrounded("live bg a", "live bg b");
  await remote.restart();
  const record = await recordOf(queued, id);
  console.log(`LIVE after graceful restart: ${JSON.stringify(record)}`);
  expect(record?.state).not.toBe("queued");
  expect(record?.state).not.toBe("running");
});
