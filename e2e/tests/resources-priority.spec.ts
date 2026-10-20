import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { bashThread, type ResourceServer, sleep, startResourceServer } from "../resources-support";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const DARWIN = process.platform === "darwin";

/** 12 python procs, fixed work; prints the wall time. Plus the shell's own scheduling state and QoS bands. */
const job = (out: string) =>
  [
    `ps -o pid=,pri=,nice=,state=,flags= -p $$ > ${out}.ps`,
    `python3 -I ${FIXTURES}/rusage.py 3000000 > ${out}.qos`,
    `python3 -I ${FIXTURES}/burn.py 12 4000000 > ${out}.time`,
  ].join("; ");

const MODES = ["off", "balanced", "background"] as const;
let remote: ResourceServer;

test.describe.configure({ mode: "serial" });
test.skip(!DARWIN, "macOS priority spec");

test.beforeAll(async () => {
  const replies = Object.fromEntries(MODES.map((mode) => [`prio ${mode}`, bashThread(job(`${tmp()}/${mode}`))]));
  remote = await startResourceServer({ replies });
});
test.afterAll(async () => remote?.stop());

function tmp() {
  const dir = join(process.env.TMPDIR ?? "/tmp", "tau-prio-out");
  mkdirSync(dir, { recursive: true });
  return dir;
}

const read = (mode: string, ext: string) => readFileSync(join(tmp(), `${mode}.${ext}`), "utf8").trim();
const results: Record<string, { time: number; pri: number; bands: Record<string, number> }> = {};

for (const mode of MODES) {
  test(`priority ${mode}: the command's own state`, async () => {
    await remote.setResources({ priority: mode });
    const id = await remote.start(`prio ${mode}`);
    await remote.waitIdle(id, 180);
    const [, pri] = read(mode, "ps").split(/\s+/);
    const { bands } = JSON.parse(read(mode, "qos")) as { bands: Record<string, number> };
    results[mode] = { time: Number(read(mode, "time")), pri: Number(pri), bands };
    console.log(`PRIORITY ${mode}: ${JSON.stringify(results[mode])}`);
    await sleep(500);
  });
}

test("Background is observably lower: scheduler band, priority and a large slowdown", () => {
  const { off, balanced, background } = results;
  expect(background?.bands.background ?? 0).toBeGreaterThan(0.9);
  expect(background?.pri).toBeLessThan(10);
  expect(off?.bands.background ?? 0).toBe(0);
  expect(balanced?.bands.background ?? 0).toBe(0);
  expect((background?.time ?? 0) / (off?.time ?? 1)).toBeGreaterThan(4);
});
