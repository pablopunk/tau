// Reads the per-shard test reports that CI downloads: vitest JSON and Playwright JSON.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function jsonFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsonFiles(path);
    return name.endsWith(".json") ? [path] : [];
  });
}

export function readReports(dir) {
  return jsonFiles(dir).flatMap((path) => {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(data.testResults)) return [{ kind: "vitest", path, data }];
    if (Array.isArray(data.suites)) return [{ kind: "playwright", path, data }];
    return [];
  });
}

export function packageOf(file) {
  return file.match(/packages\/[^/]+/)?.[0] ?? "unknown";
}

/** Vitest: one entry per test (skipped included), grouped by package. */
export function vitestCounts(reports) {
  const counts = {};
  for (const { data } of reports.filter((report) => report.kind === "vitest")) {
    for (const file of data.testResults) {
      const pkg = packageOf(file.name);
      counts[pkg] = (counts[pkg] ?? 0) + file.assertionResults.length;
    }
  }
  return counts;
}

function playwrightTests(suite) {
  const own = (suite.specs ?? []).reduce((sum, spec) => sum + (spec.tests?.length ?? 0), 0);
  return (suite.suites ?? []).reduce((sum, child) => sum + playwrightTests(child), own);
}

function flakyTests(suite, trail = []) {
  const title = suite.title ? [...trail, suite.title] : trail;
  const own = (suite.specs ?? [])
    .filter((spec) => spec.tests?.some((test) => test.status === "flaky"))
    .map((spec) => `${[...title, spec.title].join(" › ")} (${spec.file})`);
  return [...own, ...(suite.suites ?? []).flatMap((child) => flakyTests(child, title))];
}

/** Playwright: one entry per test (skipped included). */
export function e2eCount(reports) {
  return reports
    .filter((report) => report.kind === "playwright")
    .reduce((sum, { data }) => sum + data.suites.reduce((n, suite) => n + playwrightTests(suite), 0), 0);
}

export function flakyE2e(reports) {
  return reports
    .filter((report) => report.kind === "playwright")
    .flatMap(({ data }) => data.suites.flatMap((suite) => flakyTests(suite)));
}
