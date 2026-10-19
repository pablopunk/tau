import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadClaudeSdkPort } from "../sdk-port";
import { createTurnBudget, type PinContext } from "./pin-context";
import { createPinReport } from "./pin-report";
import { toolSearchWritePins } from "./scenario-tool-search-write";

const REAL = process.env.TAU_REAL_CLAUDE === "1";
const MAX_TURNS = 6;
const TEN_MINUTES_MS = 10 * 60 * 1000;

/**
 * Real-CLI pins for writes and user-style servers found through tool search. Runs only with `TAU_REAL_CLAUDE=1`.
 * The fixture server is local (`fixtures/tool-search-fixture-server.mjs`) and only appends to a temp file.
 */
describe.skipIf(!REAL)("real tool-search write pins (TAU_REAL_CLAUDE=1)", () => {
  it(
    "asks before a deferred write, runs it after allow, and never prompts a read",
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), "tau-tool-search-pins-"));
      const report = createPinReport(process.env.TAU_PINS_OUT);
      const ctx: PinContext = {
        port: await loadClaudeSdkPort(),
        report,
        budget: createTurnBudget(MAX_TURNS),
        cwd,
        createdSessions: new Set(),
      };
      try {
        await toolSearchWritePins(ctx);
      } finally {
        await report.flush();
        await rm(cwd, { recursive: true, force: true });
      }
      expect(report.results.filter((row) => !row.pass)).toEqual([]);
    },
    TEN_MINUTES_MS,
  );
});
