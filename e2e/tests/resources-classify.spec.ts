import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  ALL,
  bashThread,
  type ReplyStep,
  type ResourceServer,
  sleep,
  startResourceServer,
} from "../resources-support";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const OUT = join(process.env.TMPDIR ?? "/tmp", `tau-cls-${process.pid}`);
const pri = (file: string) => `ps -o pri= -p $$ > ${OUT}/${file}`;
const heavy = (marker: string, seconds: number) =>
  `cargo test --${marker} 2>/dev/null; sleep ${seconds}; echo ${marker}-done`;
const TOOL_LINE = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });

const agent = (prompt: string) =>
  TOOL_LINE("agent", { description: prompt, prompt, run_in_background: true });

const replies: Record<string, ReplyStep[]> = {
  "cls parent": [
    {
      tools: [
        TOOL_LINE("bash", { command: `${pri("parent.pri")}; ${heavy("parent-marker", 9)}` }),
        agent("cls child a"),
        agent("cls child b"),
      ],
    },
    { text: "parent finished" },
  ],
  "cls child a": bashThread(`${pri("child-a.pri")}; ${heavy("child-a", 6)}`),
  "cls child b": bashThread(`${pri("child-b.pri")}; ${heavy("child-b", 6)}`),
  "cls tools": [
    {
      tools: [
        TOOL_LINE("bash", { command: heavy("holder", 12) }),
        TOOL_LINE("process_start", {
          name: "ps",
          command: `cargo test --ps-heavy 2>/dev/null; ${pri("ps.pri")}; echo done`,
        }),
        TOOL_LINE("monitor", {
          description: "mon",
          timeout_ms: 60_000,
          command: `${pri("mon.pri")}; echo x`,
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

const statusOf = async (id: string) => {
  const all = (await (await remote.api.get("/api/conversations")).json()) as { id: string; status: string }[];
  return all.find((thread) => thread.id === id)?.status;
};
const settled = async (id: string) => {
  const status = await statusOf(id);
  return status !== undefined && status !== "running";
};
const settledWait = async (id: string) => {
  for (let attempt = 0; attempt < 200 && !(await settled(id)); attempt++) await sleep(500);
  expect(await settled(id)).toBe(true);
};
const readPri = (file: string) => readFileSync(join(OUT, file), "utf8").trim();

test("only Subagents on: the children run at Background, the parent at full speed", async () => {
  await remote.setResources({
    levels: { main: "off", worktree: "off", subagent: "background" },
  });
  const id = await remote.start("cls parent");
  await settledWait(id);
  expect(readPri("child-a.pri")).toBe("4");
  expect(readPri("child-b.pri")).toBe("4");
  expect(readPri("parent.pri")).not.toBe("4");
  const output = (await remote.toolOutputs(id)).join("\n");
  expect(output).toContain("parent-marker-done");
});

test("only Main on: the parent runs at Background, the children at full speed", async () => {
  await remote.setResources({
    levels: { main: "background", worktree: "off", subagent: "off" },
  });
  const id = await remote.start("cls parent", { mode: "checkout" });
  await settledWait(id);
  expect(readPri("parent.pri")).toBe("4");
  expect(readPri("child-a.pri")).not.toBe("4");
});

test("only Worktrees on: a checkout thread runs full speed, a worktree thread at Background", async () => {
  await remote.setResources({
    levels: { main: "off", worktree: "background", subagent: "off" },
  });
  const checkout = await remote.start("cls parent", { mode: "checkout" });
  await settledWait(checkout);
  expect(readPri("parent.pri")).not.toBe("4");
  const worktree = await remote.start("cls parent", { mode: "worktree" });
  await settledWait(worktree);
  expect(readPri("parent.pri")).toBe("4");
});

test("process_start and monitor take the scope's priority", async () => {
  await remote.setResources(ALL("background"));
  const id = await remote.start("cls tools");
  await settledWait(id);
  expect(readPri("ps.pri")).toBe("4");
  expect(readPri("mon.pri")).toBe("4");
});
