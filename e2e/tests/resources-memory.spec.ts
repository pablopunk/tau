import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { bashThread, type ResourceServer, sleep, startResourceServer } from "../resources-support";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const HOG = `python3 -I ${FIXTURES}/hog.py`;
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test.skip(process.platform !== "darwin", "macOS polled memory limit");
test.describe.configure({ mode: "serial" });

let remote: ResourceServer;
const outputOf = async (id: string, seconds: number) => {
  await remote.waitIdle(id, seconds);
  return (await remote.toolOutputs(id)).join("\n---\n");
};
let pids: string;

test.beforeAll(async () => {
  const dir = join(process.env.TMPDIR ?? "/tmp", `tau-mem-${process.pid}`);
  pids = dir;
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  remote = await startResourceServer({
    replies: {
      "mem hog": bashThread(`${HOG} hog 5000`),
      "mem escapee": bashThread(`${HOG} escapee 4500 ${dir}/escapee.pid`),
      "mem daemon": bashThread(`${HOG} daemon 4500 ${dir}/daemon.pid`),
      "mem small": bashThread(`${HOG} hog 60 & sleep 5; echo small-done`),
      "mem shared": bashThread(`${HOG} shared 1100`),
    },
  });
  await remote.setResources({ levels: { main: "balanced", worktree: "off", subagent: "off" } });
});
test.afterAll(async () => remote?.stop());

test("a 5 GB command is stopped with the memory message, after the first 2 s sweep (over 1.5x)", async () => {
  const begun = Date.now();
  const id = await remote.start("mem hog");
  const text = await outputOf(id, 90);
  const seconds = (Date.now() - begun) / 1000;
  console.log(`MEMORY hog: ended after ${seconds.toFixed(1)} s\n${text}`);
  expect(text).toContain(
    "Stopped: memory limit 4096 MB exceeded (resource control is on: Main threads run at Balanced). " +
      "To allow more memory, set Main threads to Off in Settings → Agent, or split the work into smaller steps.",
  );
  expect(seconds).toBeGreaterThan(2);
  expect(seconds).toBeLessThan(90);
});

test("a setsid escapee holding memory dies with its command", async () => {
  const begun = Date.now();
  const id = await remote.start("mem escapee");
  const text = await outputOf(id, 90);
  console.log(`MEMORY escapee:\n${text}`);
  expect(text).toContain(
    "Stopped: memory limit 4096 MB exceeded (resource control is on: Main threads run at Balanced). " +
      "To allow more memory, set Main threads to Off in Settings → Agent, or split the work into smaller steps.",
  );
  console.log(`MEMORY escapee: ended after ${((Date.now() - begun) / 1000).toFixed(1)} s`);
  const pid = Number(readFileSync(join(pids, "escapee.pid"), "utf8"));
  await sleep(1500);
  expect(alive(pid)).toBe(false);
});

test("an escapee left behind after the command ends is still stopped (30 s tail)", async () => {
  const id = await remote.start("mem daemon");
  await remote.waitIdle(id, 60);
  const pid = Number(readFileSync(join(pids, "daemon.pid"), "utf8"));
  const begun = Date.now();
  while (alive(pid) && Date.now() - begun < 40_000) await sleep(500);
  console.log(
    `MEMORY daemon: escapee alive after command end for ${((Date.now() - begun) / 1000).toFixed(1)} s`,
  );
  expect(alive(pid)).toBe(false);
});

test("no false kill: a command well under the limit", async () => {
  const id = await remote.start("mem small");
  const text = await outputOf(id, 60);
  expect(text).toContain("small-done");
  expect(text).not.toContain("Stopped: memory limit");
});

test("no false kill: 1.1 GB shared with 3 readers (RSS sums to ~4.4 GB, real footprint ~1.1 GB)", async () => {
  const id = await remote.start("mem shared");
  const text = await outputOf(id, 60);
  console.log(`MEMORY shared:\n${text}`);
  expect(text).not.toContain("Stopped: memory limit");
});
