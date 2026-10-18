import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadClaudeSdkPort } from "../sdk-port";
import { createTurnBudget, MAX_PIN_TURNS, type PinContext } from "./pin-context";
import { createPinReport, type PinReport } from "./pin-report";
import { runResumeAtFork } from "./scenario-fork";
import { runInterruptThenResume } from "./scenario-interrupt-resume";
import { runMainSession } from "./scenario-main-session";

const REAL = process.env.TAU_REAL_CLAUDE === "1";
const TEN_MINUTES_MS = 10 * 60 * 1000;

async function runGuarded<T>(report: PinReport, scenario: string, body: () => Promise<T>): Promise<T | null> {
  let outcome: T | null = null;
  await report.run(`scenario:${scenario}`, "the scenario ran to its end", async () => {
    outcome = await body();
    return "ok";
  });
  return outcome;
}

async function deleteCreatedSessions(ctx: PinContext): Promise<string> {
  const outcomes: string[] = [];
  for (const sessionId of ctx.createdSessions) {
    await ctx.port.deleteSession(sessionId).then(
      () => outcomes.push(`${sessionId}: deleted`),
      (error: unknown) =>
        outcomes.push(`${sessionId}: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
  return outcomes.join("; ");
}

/**
 * Real-CLI pins (a) to (j) from MVP9.md. Runs only with `TAU_REAL_CLAUDE=1`, under the user's own claude login,
 * with at most six Haiku turns. `TAU_PINS_OUT` names a file for the JSON verdicts.
 */
describe.skipIf(!REAL)("real claude pins (TAU_REAL_CLAUDE=1)", () => {
  it(
    "runs pins a to j within the turn budget",
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), "tau-claude-pins-"));
      const report = createPinReport(process.env.TAU_PINS_OUT);
      const ctx: PinContext = {
        port: await loadClaudeSdkPort(),
        report,
        budget: createTurnBudget(MAX_PIN_TURNS),
        cwd,
        createdSessions: new Set(),
      };
      try {
        const main = await runGuarded(report, "main", () => runMainSession(ctx));
        await runGuarded(report, "interrupt", () => runInterruptThenResume(ctx));
        if (main) await runGuarded(report, "fork", () => runResumeAtFork(ctx, main));
        await report.run("cleanup", "deleteSession removes the sessions the pins created", async () =>
          deleteCreatedSessions(ctx),
        );
      } finally {
        await report.run("budget", `at most ${MAX_PIN_TURNS} Haiku turns`, async () =>
          ctx.budget.spent().join(" | "),
        );
        await report.flush();
        await rm(cwd, { recursive: true, force: true });
      }
      expect(ctx.budget.spent().length).toBeLessThanOrEqual(MAX_PIN_TURNS);
    },
    TEN_MINUTES_MS,
  );
});
