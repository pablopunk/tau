import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "@playwright/test";
import { type ResourceServer, type ResourceValues, sleep, startResourceServer } from "../resources-support";

/**
 * Real-world comparison, opt in: TAU_COMPARE_REPO=/tmp/tau-copy TAU_E2E_COMPARE=1 playwright test tests/resources-compare.spec.ts
 * Four threads each run the @tau/core test suite in a copy of this repo; results go to $TAU_COMPARE_OUT (default /tmp/tau-compare.json).
 */
const run = promisify(execFile);
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const REPO = process.env.TAU_COMPARE_REPO ?? "";
const OUT = process.env.TAU_COMPARE_OUT ?? "/tmp/tau-compare.json";
const THREADS = 4;
const ALL = { main: true, worktrees: true, subagents: true };
const MODES: Record<string, Partial<ResourceValues>> = {
  off: {},
  "slots 2": { heavySlots: 2, appliesTo: ALL },
  "balanced + slots 2": { priority: "balanced", heavySlots: 2, appliesTo: ALL },
  "background + slots 2": { priority: "background", heavySlots: 2, appliesTo: ALL },
};
const only = process.env.TAU_COMPARE_MODES?.split(",");

const now = () => Date.now() / 1000;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0;

async function probeOnce(): Promise<number> {
  const { stdout } = await run("python3", ["-I", `${FIXTURES}/burn.py`, "1", "6000000"]);
  return Number(stdout.trim());
}

async function sampleProcesses() {
  const { stdout } = await run("ps", ["-axo", "pcpu=,command="], { maxBuffer: 64 * 1024 * 1024 });
  let testProcesses = 0;
  let suites = 0;
  let cpu = 0;
  for (const line of stdout.split("\n")) {
    if (!line.includes(REPO) && !line.includes(`/private${REPO}`)) continue;
    testProcesses++;
    cpu += Number.parseFloat(line.trim().split(/\s+/)[0] ?? "0");
    if (line.includes("vitest.mjs run")) suites++;
  }
  return { testProcesses, suites, cpu };
}

test.skip(!process.env.TAU_E2E_COMPARE || !REPO, "opt in with TAU_E2E_COMPARE=1 and TAU_COMPARE_REPO");
test.setTimeout(3 * 60 * 60 * 1000);

const results: Record<string, unknown> = {};

for (const [mode, patch] of Object.entries(MODES)) {
  test(`mode: ${mode}`, async () => {
    if (only && !only.includes(mode)) test.skip();
    const outDir = join(process.env.TMPDIR ?? "/tmp", `tau-cmp-${process.pid}-${mode.replace(/\W+/g, "_")}`);
    await run("mkdir", ["-p", outDir]);
    const command = (index: number) =>
      [
        `python3 -c 'import time;print(time.time())' > ${outDir}/t${index}.start`,
        `mise exec -- pnpm --filter @tau/core test > ${outDir}/t${index}.log 2>&1`,
        `python3 -c 'import time;print(time.time())' > ${outDir}/t${index}.end`,
        `times > ${outDir}/t${index}.times`,
      ].join("; ");
    const replies = Object.fromEntries(
      Array.from({ length: THREADS }, (_, index) => [
        `compare ${index}`,
        [{ tools: [{ name: "bash", arguments: { command: command(index) } }] }, { text: "done" }],
      ]),
    );
    const remote: ResourceServer = await startResourceServer({ replies, repo: REPO, env: { HOME: process.env.HOME ?? "" } });
    try {
      await remote.setResources({ ...patch });
      const baseline = [];
      for (let index = 0; index < 5; index++) baseline.push(await probeOnce());
      const began = now();
      const ids: string[] = [];
      for (let index = 0; index < THREADS; index++) ids.push(await remote.start(`compare ${index}`, { mode: "checkout" }));
      const samples: { t: number; load: number; procs: number; suites: number; cpu: number }[] = [];
      const probe: number[] = [];
      let finished = false;
      const sampler = (async () => {
        while (!finished) {
          const sample = await sampleProcesses();
          samples.push({ t: now() - began, load: loadavg()[0] ?? 0, procs: sample.testProcesses, suites: sample.suites, cpu: sample.cpu });
          await sleep(2000);
        }
      })();
      const prober = (async () => {
        while (!finished) {
          probe.push(await probeOnce());
          await sleep(500);
        }
      })();
      await Promise.all(ids.map((id) => remote.waitIdle(id, 3600)));
      finished = true;
      await Promise.all([sampler, prober]);
      const wall = now() - began;
      const perThread = ids.map((_, index) => {
        const start = Number(readFileSync(`${outDir}/t${index}.start`, "utf8"));
        const end = Number(readFileSync(`${outDir}/t${index}.end`, "utf8"));
        const times = readFileSync(`${outDir}/t${index}.times`, "utf8").trim().split("\n")[1] ?? "";
        const [user, sys] = times.split(/\s+/).map((value) => {
          const [minutes, seconds] = value.replace("s", "").split("m");
          return Number(minutes) * 60 + Number(seconds);
        });
        // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes
        const log = readFileSync(`${outDir}/t${index}.log`, "utf8").replace(/\u001b\[[0-9;]*m/g, "");
        return {
          queuedFor: Math.round(start - began),
          ran: Math.round(end - start),
          cpu: Math.round((user ?? 0) + (sys ?? 0)),
          result: /^\s*Tests\s+(.*)$/m.exec(log)?.[1] ?? "no summary",
        };
      });
      results[mode] = {
        wallSeconds: Math.round(wall),
        peakSuitesAtOnce: Math.max(...samples.map((sample) => sample.suites)),
        peakTestProcesses: Math.max(...samples.map((sample) => sample.procs)),
        peakLoad1m: Math.round(Math.max(...samples.map((sample) => sample.load)) * 10) / 10,
        meanLoad1m: Math.round((samples.reduce((sum, sample) => sum + sample.load, 0) / samples.length) * 10) / 10,
        totalCpuSeconds: perThread.reduce((sum, thread) => sum + thread.cpu, 0),
        perThread,
        probeIdleMedian: median(baseline),
        probeUnderLoad: { median: median(probe), p95: p95(probe), max: Math.max(...probe), n: probe.length },
      };
      console.log(`COMPARE ${mode}: ${JSON.stringify(results[mode])}`);
      writeFileSync(OUT, JSON.stringify(results, null, 2));
    } finally {
      await remote.stop();
    }
  });
}
