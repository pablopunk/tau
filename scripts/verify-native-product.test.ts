import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, parseArgs, parseScenarioManifest, REQUIRED_ASSERTIONS } from "./verify-native-product";

const owned: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true });
});
const scenarios = () => ({
  version: 1,
  namespace: "B",
  seed: 15158,
  fixtures: {},
  cases: REQUIRED_ASSERTIONS.map((id) => ({ id, fixtureId: "small-v1", requiredAssertions: [id] })),
});
async function world() {
  const root = await mkdtemp(join(tmpdir(), "tau-F-native-parser-"));
  owned.push(root);
  const path = join(root, "scenarios.json");
  const output = join(root, "report.json");
  await writeFile(path, JSON.stringify(scenarios()));
  return { path, output, argv: ["--scenarios", path, "--output", output] };
}

describe("native proof parser, no SDK or process execution", () => {
  it("accepts exactly the frozen distinct flags", () => {
    expect(parseArgs(["--scenarios", "s", "--output", "o"])).toEqual({ scenarios: "s", output: "o" });
    for (const argv of [
      [],
      ["--scenarios"],
      ["--scenarios", "--output"],
      ["--artifacts", "a"],
      ["--scenarios", "s", "--scenarios", "s", "--output", "o"],
      ["--scenarios", "s", "--output", "s"],
    ])
      expect(() => parseArgs(argv)).toThrow();
  });
  it("freezes all eight crash barriers plus denial, retry and cleanup evidence", () => {
    expect(parseScenarioManifest(scenarios()).cases).toHaveLength(11);
    expect(REQUIRED_ASSERTIONS).toContain("B.persisted-result-pre-finalization");
    expect(REQUIRED_ASSERTIONS).toContain("B.owned-process-cleanup");
  });
  it("rejects duplicate cases/assertions and wrong namespaces", () => {
    const value = scenarios();
    for (const cases of [
      [value.cases[0], value.cases[0]],
      [{ id: "E.case", fixtureId: "small-v1", requiredAssertions: [] }],
      [{ id: "B.case", fixtureId: "small-v1", requiredAssertions: ["B.one", "B.one"] }],
    ])
      expect(() => parseScenarioManifest({ ...value, cases })).toThrow("invalid_scenario_manifest");
    expect(() => parseScenarioManifest({ ...value, namespace: "C" })).toThrow();
  });
  it("rejects non-integer seeds, incomplete schemas, unknown results and unsafe IDs", () => {
    for (const value of [
      {},
      { ...scenarios(), seed: 1.5 },
      { ...scenarios(), result: "PASS" },
      {
        ...scenarios(),
        cases: [{ id: "B.https://token@example.invalid", fixtureId: "small-v1", requiredAssertions: [] }],
      },
    ])
      expect(() => parseScenarioManifest(value)).toThrow();
  });
  it("returns 64 for bad invocation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main([])).toBe(64);
  });
  it("always blocks complete declarations with zero actual assertions", async () => {
    const w = await world();
    expect(await main(w.argv)).toBe(2);
    const report = JSON.parse(await readFile(w.output, "utf8"));
    expect(report).toMatchObject({
      verdict: "BLOCKED",
      sdk: { pinnedVersionVerified: false, productionControllerExecuted: false },
      counts: { required: 11, asserted: 0, passed: 0, blocked: 11 },
      cleanup: { verified: false },
    });
    expect(report.assertions.every((item: { status: string }) => item.status === "BLOCKED")).toBe(true);
    expect(report.missingStages).toEqual([
      "submit",
      "request-arrival",
      "workspace-ready",
      "before-input-snapshot",
      "admission-sdk-launch",
      "first-assistant-text",
      "browser-render",
      "failure-cancel",
    ]);
  });
  it("blocks missing scenarios instead of falling back to host settings", async () => {
    const w = await world();
    await rm(w.path);
    expect(await main(w.argv)).toBe(2);
    expect(JSON.parse(await readFile(w.output, "utf8")).reasons).toContain("missing_scenario_manifest");
  });
  it("blocks empty or incomplete required cases", async () => {
    const w = await world();
    await writeFile(w.path, JSON.stringify({ ...scenarios(), cases: [] }));
    expect(await main(w.argv)).toBe(2);
    expect(JSON.parse(await readFile(w.output, "utf8")).reasons).toEqual(
      expect.arrayContaining(["no_scenarios", "missing_required_cases"]),
    );
  });
  it("rejects malformed JSON/schema without echoing private content", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = await world();
    await writeFile(w.path, '{"auth":"Bearer PRIVATE"');
    expect(await main(w.argv)).toBe(64);
    expect(error).toHaveBeenCalledWith("invalid_scenario_manifest");
  });
  it("allowlists report fields instead of copying fixture secrets", async () => {
    const w = await world();
    await writeFile(
      w.path,
      JSON.stringify({
        ...scenarios(),
        fixtures: {
          token: "Bearer PRIVATE",
          content: "/Users/private/company",
          url: "https://auth:secret@example.invalid",
        },
      }),
    );
    expect(await main(w.argv)).toBe(2);
    const report = await readFile(w.output, "utf8");
    for (const secret of ["Bearer", "PRIVATE", "/Users", "example.invalid", "secret"])
      expect(report).not.toContain(secret);
  });
  it("does not overwrite existing reports", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const w = await world();
    await writeFile(w.output, "existing");
    expect(await main(w.argv)).toBe(2);
    expect(await readFile(w.output, "utf8")).toBe("existing");
  });
  it("imports without native query, OS probes, services or provider calls", () => {
    expect(typeof main).toBe("function");
  });
});
