import { describe, expect, it } from "vitest";
import { createFootprint, parseFootprintOutput } from "./footprint";
import { createMemoryWatch } from "./memory-watch";
import { membersOf, type ProcRow, parsePsLine, parsePsOutput } from "./ps-sweep";

const row = (
  pid: number,
  ppid: number,
  pgid: number,
  rssKb: number,
  start = "Thu Oct 15 10:25:50 2026",
): ProcRow => ({
  pid,
  ppid,
  pgid,
  rssKb,
  start,
});

describe("ps parsing", () => {
  it("reads lstart as the last five tokens", () => {
    expect(parsePsLine("  123   1  123  2048 Thu Oct  5 10:25:50 2026")).toEqual({
      pid: 123,
      ppid: 1,
      pgid: 123,
      rssKb: 2048,
      start: "Thu Oct 5 10:25:50 2026",
    });
    expect(parsePsOutput("garbage\n1 0 1 10 Thu Oct 15 10:25:50 2026\n")).toHaveLength(1);
  });
});

describe("membersOf", () => {
  it("collects descendants, the process group and sticky escapees", () => {
    const rows = [
      row(10, 1, 10, 1),
      row(11, 10, 10, 1),
      row(12, 11, 12, 1),
      row(20, 1, 10, 1),
      row(30, 1, 30, 1),
    ];
    const pids = (found: ProcRow[]) => found.map((member) => member.pid).sort();
    expect(pids(membersOf(rows, 10, new Map()))).toEqual([10, 11, 12, 20]);
    expect(pids(membersOf(rows, 10, new Map([[30, row(30, 1, 30, 1).start]])))).toEqual([10, 11, 12, 20, 30]);
  });

  it("ignores a sticky pid whose start time changed (pid reuse)", () => {
    const rows = [row(10, 1, 10, 1), row(30, 1, 30, 1, "Fri Oct 16 11:00:00 2026")];
    const found = membersOf(rows, 10, new Map([[30, "Thu Oct 15 10:25:50 2026"]]));
    expect(found.map((member) => member.pid)).toEqual([10]);
  });
});

const setup = (
  rowsFor: () => ProcRow[],
  footprint?: (pids: readonly number[]) => Promise<number | undefined>,
) => {
  let now = 0;
  const signals: Array<[number, string]> = [];
  let swept = 0;
  const watch = createMemoryWatch({
    sweep: async () => {
      swept++;
      return rowsFor();
    },
    now: () => now,
    graceMs: 0,
    footprint,
    signal: (pid, signal) => signals.push([pid, signal]),
    sleep: async () => {},
  });
  return { watch, signals, advance: (ms: number) => (now += ms), swept: () => swept };
};

describe("memory watch", () => {
  it("does not sweep before a command has run for 2 s", async () => {
    const state = setup(() => [row(10, 1, 10, 1)]);
    state.watch.watch({ rootPid: 10, limitMb: 1, onOverLimit: () => {} });
    await state.watch.sweepNow();
    expect(state.swept()).toBe(0);
  });

  it("kills after two sweeps over the limit, with a fresh sweep before KILL", async () => {
    const over = [row(10, 1, 10, 1200)];
    const state = setup(() => over);
    let marked = 0;
    state.watch.watch({ rootPid: 10, limitMb: 1, onOverLimit: () => marked++ });
    state.advance(2000);
    await state.watch.sweepNow();
    expect(state.signals).toEqual([]);
    await state.watch.sweepNow();
    await Promise.resolve();
    await Promise.resolve();
    expect(marked).toBe(1);
    expect(state.signals.map(([, signal]) => signal)).toContain("SIGTERM");
  });

  it("kills at once over 1.5x the limit", async () => {
    const state = setup(() => [row(10, 1, 10, 4 * 1024)]);
    state.watch.watch({ rootPid: 10, limitMb: 2, onOverLimit: () => {} });
    state.advance(2000);
    await state.watch.sweepNow();
    expect(state.signals[0]).toEqual([10, "SIGTERM"]);
  });

  it("stops watching after the root exits and every member is gone", async () => {
    const state = setup(() => []);
    const handle = state.watch.watch({ rootPid: 10, limitMb: 100, onOverLimit: () => {} });
    state.advance(2000);
    handle.rootExited();
    await state.watch.sweepNow();
    expect(state.watch.size()).toBe(0);
  });
});

describe("footprint confirmation", () => {
  const flush = async () => {
    for (let turn = 0; turn < 6; turn++) await Promise.resolve();
  };

  it("spares a tree whose real footprint is within the limit although its RSS is over", async () => {
    const state = setup(
      () => [row(10, 1, 10, 4 * 1024)],
      async () => 1024,
    );
    state.watch.watch({ rootPid: 10, limitMb: 2, onOverLimit: () => {} });
    state.advance(2000);
    await state.watch.sweepNow();
    await flush();
    state.advance(2000);
    await state.watch.sweepNow();
    await flush();
    expect(state.signals).toEqual([]);
  });

  it("kills when the footprint confirms, or cannot be read", async () => {
    for (const read of [async () => 5 * 1024, async () => undefined]) {
      const state = setup(() => [row(10, 1, 10, 4 * 1024)], read);
      state.watch.watch({ rootPid: 10, limitMb: 2, onOverLimit: () => {} });
      state.advance(2000);
      await state.watch.sweepNow();
      await flush();
      expect(state.signals[0]).toEqual([10, "SIGTERM"]);
    }
  });

  it("parses the summary (shared memory once), a single pid, and nothing", () => {
    const two =
      "Python [1]: 64-bit    Footprint: 133612096 B (16384 bytes per page)\nPython [2]: 64-bit    Footprint: 128139648 B (16384 bytes per page)\nSummary Footprint: 138085696 B\n";
    expect(parseFootprintOutput(two)).toBe(134849);
    expect(parseFootprintOutput("node [5]: 64-bit    Footprint: 12076592 B (16384 bytes per page)\n")).toBe(
      11794,
    );
    expect(parseFootprintOutput("footprint: Unable to find pid")).toBeUndefined();
  });

  it("asks footprint for every pid in one call, in the C locale", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const read = createFootprint(async (file, args) => {
      calls.push({ file, args });
      return { code: 0, stdout: "Summary Footprint: 2048 B\n", stderr: "", timedOut: false };
    });
    expect(await read([4, 5])).toBe(2);
    expect(calls[0]?.args).toEqual(["-p", "4", "-p", "5", "--noCategories", "-f", "bytes"]);
    expect(await read([])).toBeUndefined();
  });
});
