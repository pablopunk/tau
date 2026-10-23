import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  main,
  parseArgs,
  parseArtifactManifest,
  parseScenarioManifest,
  REQUIRED_ASSERTIONS,
} from "./verify-product-artifact";

const owned: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true });
});
const sha256 = "a".repeat(64);
const artifact = () => ({
  directory: "/synthetic/private/token-secret",
  binary: { path: "bin/tau", sha256 },
  version: "0.11.0",
  platform: { os: "darwin", arch: "arm64" },
  web: {
    index: { path: "web/index.html", sha256 },
    js: [{ path: "web/assets/index.js", sha256 }],
    css: [{ path: "web/assets/index.css", sha256 }],
  },
  sdk: { name: "@anthropic-ai/claude-agent-sdk", version: "0.2.0" },
});
const manifest = () => ({ version: 1, baseline: artifact(), candidate: artifact() });
const scenarios = () => ({
  version: 1,
  namespace: "E",
  seed: 15158,
  fixtures: {},
  cases: REQUIRED_ASSERTIONS.map((id) => ({ id, fixtureId: "small-v1", requiredAssertions: [id] })),
});

async function world() {
  const root = await mkdtemp(join(tmpdir(), "tau-F-artifact-parser-"));
  owned.push(root);
  const artifacts = join(root, "artifacts.json");
  const scenarioPath = join(root, "scenarios.json");
  const output = join(root, "report.json");
  await writeFile(artifacts, JSON.stringify(manifest()));
  await writeFile(scenarioPath, JSON.stringify(scenarios()));
  return {
    root,
    artifacts,
    scenarioPath,
    output,
    argv: ["--artifacts", artifacts, "--scenarios", scenarioPath, "--output", output],
  };
}

describe("artifact proof parsing and blocked skeleton", () => {
  it("accepts only the distinct frozen flags without duplicate or missing values", () => {
    expect(parseArgs(["--artifacts", "a", "--scenarios", "s", "--output", "o"])).toEqual({
      artifacts: "a",
      scenarios: "s",
      output: "o",
    });
    for (const argv of [
      [],
      ["--json", "x"],
      ["--artifacts"],
      ["--artifacts", "--scenarios"],
      ["--artifacts", "a", "--artifacts", "b"],
      ["--artifacts", "a", "--scenarios", "s", "--output", "a"],
    ])
      expect(() => parseArgs(argv)).toThrow();
  });
  it("requires both complete version-directory descriptors and pinned provenance", () => {
    expect(parseArtifactManifest(manifest()).candidate.binary.sha256).toBe(sha256);
    for (const value of [
      { version: 1, candidate: artifact() },
      { ...manifest(), extra: "PASS" },
      { ...manifest(), candidate: { ...artifact(), sdk: null } },
      { ...manifest(), baseline: { ...artifact(), platform: { os: "other", arch: "arm64" } } },
    ])
      expect(() => parseArtifactManifest(value)).toThrow("invalid_manifest");
  });
  it.each([
    "0.11.0",
    "0.0.0-0",
    "1.2.3-rc.1+build.7",
    "1.2.3+001.007",
    "2.10.123-alpha-beta.01a+build.00",
    "1.2.3--+---",
  ])("accepts exact SemVer 2.0 artifact and SDK version %s", (version) => {
    const candidate = { ...artifact(), version, sdk: { ...artifact().sdk, version } };
    const parsed = parseArtifactManifest({ ...manifest(), candidate });
    expect(parsed.candidate.version).toBe(version);
    expect(parsed.candidate.sdk.version).toBe(version);
  });
  it.each([
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2.3-...",
    "1.2.3-01",
    "1.2.3-alpha.01",
    "1.2.3+",
    "1.2.3-",
    "1.2.3+build..7",
    "1.2.3-rc..1",
    "1.2.3-rc.1+build.7+extra",
    "v1.2.3",
    " 1.2.3",
    "1.2.3\n",
    "1.2.3\r\n",
    "1.2.3+build_7",
  ])("rejects non-SemVer or non-exact version %j in either version field", (version) => {
    expect(() => parseArtifactManifest({ ...manifest(), candidate: { ...artifact(), version } })).toThrow(
      "invalid_manifest",
    );
    expect(() =>
      parseArtifactManifest({
        ...manifest(),
        candidate: { ...artifact(), sdk: { ...artifact().sdk, version } },
      }),
    ).toThrow("invalid_manifest");
  });
  it("rejects invalid checksums, path traversal, empty frontend assets and unpinned SDK versions", () => {
    for (const candidate of [
      { ...artifact(), binary: { path: "bin/tau", sha256: "bad" } },
      { ...artifact(), binary: { path: "../tau", sha256 } },
      { ...artifact(), binary: { path: "C:\\tau", sha256 } },
      { ...artifact(), web: { ...artifact().web, js: [] } },
      { ...artifact(), sdk: { name: "@anthropic-ai/claude-agent-sdk", version: "latest" } },
    ])
      expect(() => parseArtifactManifest({ ...manifest(), candidate })).toThrow("invalid_manifest");
  });
  it("rejects duplicate cases/assertions, wrong namespaces and hostile report identifiers", () => {
    const value = scenarios();
    expect(parseScenarioManifest(value).cases).toHaveLength(REQUIRED_ASSERTIONS.length);
    for (const cases of [
      [value.cases[0], value.cases[0]],
      [{ id: "B.other", fixtureId: "small-v1", requiredAssertions: [] }],
      [{ id: "E.https://token@private/path", fixtureId: "small-v1", requiredAssertions: [] }],
      [{ id: "E.case", fixtureId: "small-v1", requiredAssertions: ["E.one", "E.one"] }],
    ])
      expect(() => parseScenarioManifest({ ...value, cases })).toThrow();
    expect(() => parseScenarioManifest({ ...value, result: "PASS" })).toThrow();
  });
  it("returns 64 for invalid invocation and never writes a report", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main([])).toBe(64);
  });
  it("returns 2 with zero asserted evidence even for complete declarations", async () => {
    const w = await world();
    expect(await main(w.argv)).toBe(2);
    const report = JSON.parse(await readFile(w.output, "utf8"));
    expect(report).toMatchObject({
      verdict: "BLOCKED",
      counts: { required: 8, asserted: 0, passed: 0, blocked: 8 },
      cleanup: { verified: false },
    });
    expect(report.assertions.every((item: { status: string }) => item.status === "BLOCKED")).toBe(true);
    expect(report.scenarioSha256).toBe(
      createHash("sha256")
        .update(await readFile(w.scenarioPath))
        .digest("hex"),
    );
    expect(report.provenance.every((item: { verified: boolean }) => !item.verified)).toBe(true);
  });
  it("blocks a missing artifact descriptor rather than silently using Node or the checkout", async () => {
    const w = await world();
    await rm(w.artifacts);
    expect(await main(w.argv)).toBe(2);
    expect(JSON.parse(await readFile(w.output, "utf8")).reasons).toContain("missing_artifact_descriptor");
  });
  it("blocks a missing scenario file, empty cases and omitted required cases", async () => {
    const w = await world();
    await rm(w.scenarioPath);
    expect(await main(w.argv)).toBe(2);
    expect(JSON.parse(await readFile(w.output, "utf8")).reasons).toContain("missing_scenario_manifest");
    await rm(w.output);
    await writeFile(w.scenarioPath, JSON.stringify({ ...scenarios(), cases: [] }));
    expect(await main(w.argv)).toBe(2);
    expect(JSON.parse(await readFile(w.output, "utf8")).reasons).toEqual(
      expect.arrayContaining(["no_scenarios", "missing_required_cases"]),
    );
  });
  it("returns 64 for malformed JSON/schema, using constant scrubbed diagnostics", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = await world();
    await writeFile(w.artifacts, '{"private":"https://token-secret@example.invalid/private"');
    expect(await main(w.argv)).toBe(64);
    expect(error).toHaveBeenCalledWith("invalid_artifact_descriptor");
  });
  it("does not serialize paths, fixture content, URLs or auth from declarations", async () => {
    const w = await world();
    await writeFile(
      w.scenarioPath,
      JSON.stringify({
        ...scenarios(),
        fixtures: { private: "https://user:token-secret@example.invalid/private", auth: "Bearer SECRET" },
      }),
    );
    expect(await main(w.argv)).toBe(2);
    const report = await readFile(w.output, "utf8");
    for (const secret of ["token-secret", "Bearer", "SECRET", "/synthetic", "example.invalid"])
      expect(report).not.toContain(secret);
  });
  it("refuses to overwrite reports and reports output failures without raw paths", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = await world();
    await writeFile(w.output, "owned-existing");
    expect(await main(w.argv)).toBe(2);
    expect(await readFile(w.output, "utf8")).toBe("owned-existing");
    expect(error).toHaveBeenCalledWith("report_not_written");
  });
  it("keeps artifact discovery isolated from default Playwright server discovery", async () => {
    const config = await readFile(new URL("../e2e/product-recovery.config.ts", import.meta.url), "utf8");
    expect(config).toContain('testDir: "./product-tests"');
    expect(config).toContain('testMatch: "product-recovery-artifact.spec.ts"');
    expect(config).not.toContain("webServer");
    const spec = await readFile(
      new URL("../e2e/product-tests/product-recovery-artifact.spec.ts", import.meta.url),
      "utf8",
    );
    expect(spec).toContain("BLOCKED:");
    expect(spec).not.toContain("test.skip");
  });
  it("validates tracked scenario seeds and fixture inventory hashes without creating repositories", async () => {
    let expectedFixtures: unknown;
    for (const namespace of ["E", "B", "C"]) {
      const value = JSON.parse(
        await readFile(
          new URL(`../e2e/fixtures/product-recovery/${namespace}.scenarios.json`, import.meta.url),
          "utf8",
        ),
      );
      expect(value.seed).toBe(15158);
      expect(value.namespace).toBe(namespace);
      if (namespace === "E") expect(parseScenarioManifest(value).cases).toHaveLength(8);
      if (expectedFixtures) expect(value.fixtures).toEqual(expectedFixtures);
      else expectedFixtures = value.fixtures;
    }
    const fixtures = expectedFixtures as Record<
      string,
      {
        files: number;
        bytesPerFile: number;
        directories: number;
        payloadBytes: number;
        inventorySha256: string;
      }
    >;
    for (const fixture of Object.values(fixtures)) {
      const inventory = createHash("sha256");
      for (let index = 0; index < fixture.files; index++) {
        const line = `product-recovery/v1 seed=15158 file=${index}\n`;
        const bytes = line
          .repeat(Math.ceil(fixture.bytesPerFile / line.length))
          .slice(0, fixture.bytesPerFile);
        const path = `dir-${Math.floor(index / Math.ceil(fixture.files / fixture.directories))}/file-${index}.txt`;
        inventory.update(`${createHash("sha256").update(bytes).digest("hex")}  ${path}\n`);
      }
      expect(fixture.payloadBytes).toBe(fixture.files * fixture.bytesPerFile);
      expect(inventory.digest("hex")).toBe(fixture.inventorySha256);
    }
  });
  it("imports without starting artifacts or writing output", () => {
    expect(typeof main).toBe("function");
  });
});
