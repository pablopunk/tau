import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  type Activity,
  bashThread,
  type ReplyStep,
  type ResourceServer,
  sleep,
  startResourceServer,
} from "../resources-support";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const OUT = join(process.env.TMPDIR ?? "/tmp", `tau-cls-${process.pid}`);
const heavy = (marker: string, seconds: number) =>
  `cargo test --${marker} 2>/dev/null; sleep ${seconds}; echo ${marker}-done`;
const TOOL_LINE = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });

const agent = (prompt: string) =>
  TOOL_LINE("agent", { description: prompt, prompt, run_in_background: true });

const replies: Record<string, ReplyStep[]> = {
  "cls parent": [
    {
      tools: [
        TOOL_LINE("bash", { command: heavy("parent-marker", 9) }),
        agent("cls child a"),
        agent("cls child b"),
      ],
    },
    { text: "parent finished" },
  ],
  "cls child a": bashThread(heavy("child-a", 6)),
  "cls child b": bashThread(heavy("child-b", 6)),
  "cls tools": [
    {
      tools: [
        TOOL_LINE("bash", { command: heavy("holder", 12) }),
        TOOL_LINE("process_start", {
          name: "ps",
          command: `cargo test --ps-heavy 2>/dev/null; ps -o pri= -p $$ > ${OUT}/ps.pri; python3 -I ${FIXTURES}/hog.py hog 600`,
        }),
        TOOL_LINE("monitor", {
          description: "mon",
          timeout_ms: 60_000,
          command: `ps -o pri= -p $$ > ${OUT}/mon.pri; python3 -I ${FIXTURES}/hog.py hog 600; echo x`,
        }),
      ],
    },
    { text: "tools finished" },
  ],
};

let remote: ResourceServer;
test.describe.configure({ mode: "serial" });
test.skip(process.platform !== "darwin", "uses taskpolicy and the polled memory limit");

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  remote = await startResourceServer({ replies });
});
test.afterAll(async () => remote?.stop());

/** Every command that ever held or waited for a slot while `until` runs. */
async function collect(until: () => Promise<boolean>) {
  const seen = { holders: new Set<string>(), waiting: new Set<string>(), peak: { holders: 0, waiting: 0 } };
  while (!(await until())) {
    const value: Activity = await remote.activity();
    for (const entry of value.holders) seen.holders.add(entry.command);
    for (const entry of value.waiting) seen.waiting.add(entry.command);
    seen.peak.holders = Math.max(seen.peak.holders, value.holders.length);
    seen.peak.waiting = Math.max(seen.peak.waiting, value.waiting.length);
    await sleep(150);
  }
  return seen;
}

const statusOf = async (id: string) => {
  const all = (await (await remote.api.get("/api/conversations")).json()) as { id: string; status: string }[];
  return all.find((thread) => thread.id === id)?.status;
};
const settled = async (id: string) => {
  const status = await statusOf(id);
  return status !== undefined && status !== "running";
};

test("only Subagents ticked: the two subagents queue on one slot, the parent's own heavy command is not governed", async () => {
  await remote.setResources({
    heavySlots: 1,
    appliesTo: { main: false, worktrees: false, subagents: true },
  });
  const id = await remote.start("cls parent");
  const seen = await collect(() => settled(id));
  console.log(`CLASSIFY seen: ${JSON.stringify({ holders: [...seen.holders], waiting: [...seen.waiting], peak: seen.peak })}`);
  const everything = [...seen.holders, ...seen.waiting].join("\n");
  expect(everything).toContain("--child-a");
  expect(everything).toContain("--child-b");
  expect(everything).not.toContain("parent-marker");
  expect(seen.peak).toEqual({ holders: 1, waiting: 1 });
  const output = (await remote.toolOutputs(id)).join("\n");
  expect(output).toContain("parent-marker-done");
  expect(output).not.toContain("Waiting for a free slot");
});

test("only Main ticked: the main thread's own heavy command is governed, subagents are not", async () => {
  await remote.waitActivity((value) => value.holders.length === 0 && value.waiting.length === 0, 60_000);
  await remote.setResources({
    heavySlots: 1,
    appliesTo: { main: true, worktrees: false, subagents: false },
  });
  const id = await remote.start("cls parent", { mode: "checkout" });
  const seen = await collect(() => settled(id));
  const everything = [...seen.holders, ...seen.waiting].join("\n");
  expect(everything).toContain("parent-marker");
  expect(everything).not.toContain("--child");
});

test("only Worktrees ticked: a checkout thread is ungoverned, a worktree thread is governed", async () => {
  await remote.waitActivity((value) => value.holders.length === 0 && value.waiting.length === 0, 60_000);
  await remote.setResources({
    heavySlots: 1,
    appliesTo: { main: false, worktrees: true, subagents: false },
  });
  const checkout = await remote.start("cls parent", { mode: "checkout" });
  const ungoverned = await collect(() => settled(checkout));
  expect([...ungoverned.holders, ...ungoverned.waiting]).toEqual([]);
  const worktree = await remote.start("cls parent", { mode: "worktree" });
  const governed = await collect(() => settled(worktree));
  expect([...governed.holders].join("\n")).toContain("parent-marker");
});

test("process_start and monitor take the priority and memory limit but never a slot", async () => {
  await remote.waitActivity((value) => value.holders.length === 0 && value.waiting.length === 0, 60_000);
  await remote.setResources({
    priority: "background",
    heavySlots: 1,
    memoryLimitMb: 200,
    appliesTo: { main: true, worktrees: true, subagents: true },
  });
  const id = await remote.start("cls tools");
  const seen = await collect(() => settled(id));
  const everything = [...seen.holders, ...seen.waiting].join("\n");
  expect(everything).toContain("--holder");
  expect(everything).not.toContain("ps-heavy");
  expect(seen.peak.waiting).toBe(0);
  expect(readFileSync(join(OUT, "ps.pri"), "utf8").trim()).toBe("4");
  expect(readFileSync(join(OUT, "mon.pri"), "utf8").trim()).toBe("4");
  const processes = (await (await remote.api.get(`/api/conversations/${id}/processes`)).json()) as {
    name: string;
    state: string;
  }[];
  console.log(`CLASSIFY processes: ${JSON.stringify(processes)}`);
  const states = Object.fromEntries(processes.map((entry) => [entry.name, entry.state]));
  expect(states.ps).toBe("killed");
  expect(Object.values(states)).not.toContain("queued");
});
