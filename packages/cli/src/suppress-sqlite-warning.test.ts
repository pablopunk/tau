import { describe, expect, it, vi } from "vitest";
import { withoutSqliteWarning } from "./suppress-sqlite-warning";

describe("withoutSqliteWarning", () => {
  it("drops only the SQLite experimental warning", () => {
    const original = vi.fn();
    const filtered = withoutSqliteWarning(original as never);
    filtered("SQLite is an experimental feature and might change at any time", "ExperimentalWarning");
    filtered("Something else is experimental", "ExperimentalWarning");
    filtered("SQLite is an experimental feature", "DeprecationWarning");
    expect(original).toHaveBeenCalledTimes(2);
  });
});
