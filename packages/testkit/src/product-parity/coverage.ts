import { type ProductParityRow, parseParityRows } from "./schema";

export interface CoverageResult {
  readonly verdict: "PASS" | "FAIL" | "BLOCKED";
  readonly required: number;
  readonly asserted: number;
  readonly passed: number;
  readonly failed: readonly string[];
  readonly blocked: readonly string[];
}

/** Summarizes evidence records; it never executes CLI/UI or qualifies the product itself. */
export function checkParityCoverage(
  rows: readonly ProductParityRow[],
  requiredIds: readonly string[],
): CoverageResult {
  parseParityRows(rows);
  if (new Set(requiredIds).size !== requiredIds.length || requiredIds.some((id) => id.length === 0)) {
    throw new Error("invalid_required_assertion_ids");
  }
  const failed: string[] = [];
  const blocked: string[] = [];
  let asserted = 0;
  let passed = 0;
  for (const id of requiredIds) {
    const matches = rows.filter((row) => row.assertionIds.includes(id));
    const ambiguous = matches.length !== 1;
    if (ambiguous) blocked.push(id);
    const hasFailure = matches.some((row) =>
      row.evidence.assertions.some((assertion) => assertion.id === id && assertion.status === "FAIL"),
    );
    if (hasFailure) {
      asserted++;
      failed.push(id);
      continue;
    }
    const [row] = matches;
    if (ambiguous || !row) continue;
    const assertion = row.evidence.assertions.find((item) => item.id === id);
    if (!assertion || assertion.status === "BLOCKED" || assertion.status === "UNSUPPORTED") {
      blocked.push(id);
      continue;
    }
    if (row.evidence.status !== "proved" || row.evidence.kind === "static") {
      blocked.push(id);
      continue;
    }
    asserted++;
    passed++;
  }
  if (requiredIds.length === 0) blocked.push("no_required_assertions");
  return {
    verdict: failed.length > 0 ? "FAIL" : blocked.length > 0 || asserted === 0 ? "BLOCKED" : "PASS",
    required: requiredIds.length,
    asserted,
    passed,
    failed,
    blocked,
  };
}
