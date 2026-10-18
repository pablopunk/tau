import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lastLinesOf } from "../lifecycle/logs";
import { runServiceCommandWith } from "./service-command";
import { createTestMachine } from "./test-context";

describe("tau service", () => {
  it("lists services of every home, and uninstall --home removes only that one", async () => {
    const machine = createTestMachine();
    const output: string[] = [];
    const deps = { context: machine.context, out: (message: string) => output.push(message) };
    const dev = join(machine.osHome, "dev-home");
    await runServiceCommandWith(deps, ["list"]);
    expect(output.at(-1)).toBe("No tau services.");
    await runServiceCommandWith(deps, ["install", "--home", dev]);
    await runServiceCommandWith(deps, ["list"]);
    expect(output.at(-1)).toMatch(/^dev\.tau\.server\.[0-9a-f]{8}$/);
    await runServiceCommandWith(deps, ["uninstall", "--home", dev]);
    await runServiceCommandWith(deps, ["list"]);
    expect(output.at(-1)).toBe("No tau services.");
  });

  it("rejects an unknown action with usage", async () => {
    const machine = createTestMachine();
    await expect(
      runServiceCommandWith({ context: machine.context, out: () => undefined }, ["bogus"]),
    ).rejects.toThrow("Usage: tau service");
  });
});

describe("lastLinesOf", () => {
  it("keeps the last lines", () => {
    expect(lastLinesOf("a\nb\nc\n", 2)).toBe("b\nc");
  });
});
