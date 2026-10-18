import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExitMarker, recordStart, startRecordFiles } from "./start-record";

const home = () => startRecordFiles(mkdtempSync(join(tmpdir(), "tau-starts-")));

describe("start record", () => {
  it("reports unknown for a run that never wrote its end, then the written reason", () => {
    const files = home();
    expect(recordStart(files, 1000).previousExit.reason).toBe("unknown");
    expect(recordStart(files, 2000).previousExit.reason).toBe("unknown");
    createExitMarker(files.lastExitFile, () => 3000)("signal");
    expect(recordStart(files, 4000).previousExit.reason).toBe("signal");
  });

  it("the first exit written wins", () => {
    const files = home();
    recordStart(files, 1);
    const mark = createExitMarker(files.lastExitFile, () => 5);
    mark("signal");
    mark("clean");
    expect(recordStart(files, 10).previousExit.reason).toBe("signal");
  });

  it("five starts in five minutes is a crash loop; older ones do not count", () => {
    const files = home();
    for (const t of [0, 1000, 2000, 3000]) expect(recordStart(files, t).crashLoop).toBe(false);
    expect(recordStart(files, 4000).crashLoop).toBe(true);
    const slow = home();
    for (const t of [0, 100_000, 200_000, 300_000]) recordStart(slow, t);
    expect(recordStart(slow, 400_000).crashLoop).toBe(false);
  });

  it("keeps only the last 10 starts and survives a corrupt file", () => {
    const files = home();
    for (let i = 0; i < 12; i++) recordStart(files, i * 1_000_000);
    expect(JSON.parse(readFileSync(files.startsFile, "utf8"))).toHaveLength(10);
    writeFileSync(files.startsFile, "{nope");
    expect(recordStart(files, 99).crashLoop).toBe(false);
  });
});
