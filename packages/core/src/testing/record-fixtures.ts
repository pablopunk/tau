import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Fixture } from "@pi-everywhere/testkit";
import { SCENARIOS } from "./fixture-scenarios";
import { recordScenario } from "./record-scenario";
import { deriveSyntheticFixtures } from "./synthetic-fixtures";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../testkit/fixtures");

function hasMidStreamReset(fixture: Fixture): boolean {
  return fixture.frames.slice(1).some((frame) => frame.ops[0]?.[0] === "r");
}

async function writeFixture(fixture: Fixture) {
  await writeFile(join(FIXTURES_DIR, `${fixture.name}.json`), `${JSON.stringify(fixture)}\n`);
  console.log(`recorded ${fixture.name}: ${fixture.frames.length} frames`);
}

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });
  const recorded: Fixture[] = [];
  for (const scenario of SCENARIOS) {
    const fixture = await recordScenario(scenario);
    if (scenario.expectsMidStreamReset && !hasMidStreamReset(fixture)) {
      throw new Error(`${scenario.name}: expected a mid-stream reset frame but none was recorded`);
    }
    recorded.push(fixture);
    await writeFixture(fixture);
  }
  for (const fixture of deriveSyntheticFixtures(recorded)) await writeFixture(fixture);
}

await main();
