import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseElapsed, readLastExit } from "./status-extras";

describe("status extras", () => {
  it("reads last-exit.json and tolerates missing or corrupt files", async () => {
    const home = mkdtempSync(join(tmpdir(), "tau-exit-"));
    expect(await readLastExit(home)).toBeNull();
    writeFileSync(join(home, "last-exit.json"), "{nope");
    expect(await readLastExit(home)).toBeNull();
    writeFileSync(join(home, "last-exit.json"), '{"reason":"watchdog","at":5,"detail":"hung"}');
    expect(await readLastExit(home)).toEqual({ reason: "watchdog", at: 5, detail: "hung" });
    writeFileSync(join(home, "last-exit.json"), '{"reason":1}');
    expect(await readLastExit(home)).toBeNull();
  });

  it("parses ps elapsed time", () => {
    expect(parseElapsed("05:03")).toBe(303);
    expect(parseElapsed(" 02:05:03\n")).toBe(7503);
    expect(parseElapsed("3-00:00:01")).toBe(259201);
    expect(parseElapsed("junk")).toBeNull();
  });
});
