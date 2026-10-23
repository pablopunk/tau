import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadClaudeSdkPort } from "../sdk-port";
import { MAX_CONNECTOR_PIN_TURNS } from "./connector-harness";
import { createTurnBudget, type PinContext } from "./pin-context";
import { createPinReport } from "./pin-report";
import { allowReadPin, denyWritePin } from "./scenario-connector-approval";
import { globAndToggleTurn, mixedTurn, toggleOffPin } from "./scenario-connector-calls";
import { runGatePins } from "./scenario-connector-gates";
import { runUserServerPin } from "./scenario-connector-user-servers";
import { disallowedToolsPin } from "./scenario-disallowed-tools";
import { toolSearchBudgetPin } from "./scenario-tool-search-budget";

const REAL = process.env.TAU_REAL_CLAUDE === "1";
const ONLY = process.env.TAU_PINS_ONLY?.split(",") ?? [
  "gates",
  "n-allow",
  "n-deny",
  "m",
  "o-status",
  "l-o",
  "k",
  "t",
];
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

/**
 * Real-CLI connector pins (k) to (r) from MVP10.md. Runs only with `TAU_REAL_CLAUDE=1`, under the user's own
 * claude login, with at most eight Haiku turns and read-only connector calls. Writes are asked for and denied.
 */
describe.skipIf(!REAL)("real connector pins (TAU_REAL_CLAUDE=1)", () => {
  it(
    "runs pins k to r within the turn budget",
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), "tau-connector-pins-"));
      const report = createPinReport(process.env.TAU_PINS_OUT);
      const ctx: PinContext = {
        port: await loadClaudeSdkPort(undefined, { exposeToggleForPins: true }),
        report,
        budget: createTurnBudget(MAX_CONNECTOR_PIN_TURNS),
        cwd,
        createdSessions: new Set(),
      };
      const guarded = (name: string, body: () => Promise<void>) =>
        ONLY.includes(name)
          ? report.run(`scenario:${name}`, "the scenario ran to its end", async () => {
              await body();
              return "ok";
            })
          : Promise.resolve(true);
      try {
        await guarded("gates", () => runGatePins(ctx));
        await guarded("n-allow", () => allowReadPin(ctx));
        await guarded("n-deny", () => denyWritePin(ctx));
        await guarded("m", () => runUserServerPin(ctx));
        await guarded("o-status", () => toggleOffPin(ctx));
        await guarded("l-o", () => globAndToggleTurn(ctx));
        await guarded("k", () => mixedTurn(ctx));
        await guarded("t", () => toolSearchBudgetPin(ctx));
        await guarded("o2", () => disallowedToolsPin(ctx));
        await report.run("budget", `at most ${MAX_CONNECTOR_PIN_TURNS} Haiku turns`, async () =>
          ctx.budget.spent().join(" | "),
        );
      } finally {
        await report.flush();
        await rm(cwd, { recursive: true, force: true });
      }
      expect(ctx.budget.spent().length).toBeLessThanOrEqual(MAX_CONNECTOR_PIN_TURNS);
    },
    THIRTY_MINUTES_MS,
  );
});
