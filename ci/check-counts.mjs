// Usage: node ci/check-counts.mjs <reports-dir> [baseline.json]
// Fails when a package or the e2e suite has fewer tests than the baseline. More tests pass and print the new numbers.
import { appendFileSync, readFileSync } from "node:fs";
import { e2eCount, readReports, vitestCounts } from "./reports.mjs";

const [, , reportsDir, baselinePath = "ci/test-counts.json"] = process.argv;
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const reports = readReports(reportsDir);
const actual = { unit: vitestCounts(reports), e2e: e2eCount(reports) };

const rows = [];
let failed = false;
const compare = (name, expected, got) => {
  const status = got === undefined || got < expected ? "FAIL" : got > expected ? "more" : "ok";
  if (status === "FAIL") failed = true;
  rows.push(`| ${name} | ${expected} | ${got ?? 0} | ${status} |`);
};

for (const [pkg, expected] of Object.entries(baseline.unit)) compare(pkg, expected, actual.unit[pkg]);
compare("e2e", baseline.e2e, actual.e2e);

const table = ["| suite | baseline | actual | status |", "| --- | ---: | ---: | --- |", ...rows].join("\n");
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Test counts\n\n${table}\n`);
if (failed) {
  console.error("Test count dropped below ci/test-counts.json. Remove tests only on purpose and update the file in the same commit.");
  process.exit(1);
}
