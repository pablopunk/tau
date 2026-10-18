import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateLegacyHome } from "./migrate-legacy-home";
import { defaultHome, parseCliOptions } from "./options";

const originalHome = process.env.HOME;
let fakeHome: string;

const legacy = () => join(fakeHome, ".pi-everywhere");
const makeFolder = (path: string, marker: string) => {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "marker"), marker);
};

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "tau-migrate-"));
  process.env.HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = originalHome;
});

describe("migrateLegacyHome", () => {
  it("renames the old default folder when the new one is missing", async () => {
    makeFolder(legacy(), "old");
    await migrateLegacyHome(parseCliOptions([], {}));
    expect(existsSync(legacy())).toBe(false);
    expect(readFileSync(join(defaultHome(), "marker"), "utf8")).toBe("old");
  });

  it("leaves both folders alone when the new one exists", async () => {
    makeFolder(legacy(), "old");
    makeFolder(defaultHome(), "new");
    await migrateLegacyHome(parseCliOptions([], {}));
    expect(readFileSync(join(legacy(), "marker"), "utf8")).toBe("old");
    expect(readFileSync(join(defaultHome(), "marker"), "utf8")).toBe("new");
  });

  it("does nothing for a custom --home", async () => {
    makeFolder(legacy(), "old");
    await migrateLegacyHome(parseCliOptions(["--home", join(fakeHome, "custom")], {}));
    expect(existsSync(legacy())).toBe(true);
    expect(existsSync(defaultHome())).toBe(false);
  });

  it("does nothing when there is no old folder", async () => {
    await migrateLegacyHome(parseCliOptions([], {}));
    expect(existsSync(defaultHome())).toBe(false);
  });
});
