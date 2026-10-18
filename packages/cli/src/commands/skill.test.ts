import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { printSkill } from "./skill";
import { FakeTau, makeHome } from "./test-support";

describe("printSkill", () => {
  it("prints the first readable SKILL.md", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tau-skill-"));
    writeFileSync(join(dir, "SKILL.md"), "# tau skill");
    const fake = new FakeTau();
    await printSkill(fake.env(makeHome(), { skillPaths: [join(dir, "missing.md"), join(dir, "SKILL.md")] }));
    expect(fake.stdout).toEqual(["# tau skill"]);
  });

  it("falls back to a short message when the skill is not bundled", async () => {
    const fake = new FakeTau();
    await printSkill(fake.env(makeHome(), { skillPaths: [join(tmpdir(), "no-such-skill.md")] }));
    expect(fake.stdout[0]).toContain("not bundled");
  });
});
