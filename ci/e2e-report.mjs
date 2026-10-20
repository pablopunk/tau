// Usage: node ci/e2e-report.mjs <reports-dir>
// Writes the flaky e2e tests and the slowest first attempts to the job summary.
import { appendFileSync } from "node:fs";
import { flakyE2e, readReports } from "./reports.mjs";

const [, , reportsDir] = process.argv;
const reports = readReports(reportsDir).filter((report) => report.kind === "playwright");
const flaky = flakyE2e(reports);

const lines = ["## e2e flaky tests", ""];
lines.push(...(flaky.length ? flaky.map((name) => `- ${name}`) : ["None."]));
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
