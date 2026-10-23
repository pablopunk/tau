import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type BenchmarkConfig, ConfigError, configHash, parseConfig } from "./config";

const shippedConfig = (): unknown =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../../../e2e/runtime-benchmark.config.json"), "utf8"),
  );

const mutated = (change: (draft: Record<string, unknown>) => void): unknown => {
  const draft = structuredClone(shippedConfig()) as Record<string, unknown>;
  change(draft);
  return draft;
};

const problemsOf = (value: unknown): readonly string[] => {
  try {
    parseConfig(value);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
};

describe("parseConfig", () => {
  it("accepts the shipped config and keeps its explicit overhead-only statement", () => {
    const config = parseConfig(shippedConfig());

    expect(config.deterministicOverheadOnly).toBe(true);
    expect(config.executors).toEqual(["pi", "claude-code"]);
    expect(config.concurrency).toEqual([1, 4]);
  });

  it("refuses a config that does not state deterministicOverheadOnly: true", () => {
    expect(
      problemsOf(
        mutated((draft) => {
          draft.deterministicOverheadOnly = false;
        }),
      ).join(),
    ).toContain("/deterministicOverheadOnly");
    expect(
      problemsOf(
        mutated((draft) => {
          delete draft.deterministicOverheadOnly;
        }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    [
      "an unknown executor",
      (draft: Record<string, unknown>) => {
        draft.executors = ["pi", "gpt"];
      },
      "/executors/1",
    ],
    [
      "a concurrency other than 1 or 4",
      (draft: Record<string, unknown>) => {
        draft.concurrency = [2];
      },
      "/concurrency/0",
    ],
    [
      "zero samples",
      (draft: Record<string, unknown>) => {
        draft.samples = 0;
      },
      "/samples",
    ],
    [
      "a repeated executor",
      (draft: Record<string, unknown>) => {
        draft.executors = ["pi", "pi"];
      },
      "/executors",
    ],
    [
      "an unknown key",
      (draft: Record<string, unknown>) => {
        draft.extra = 1;
      },
      "/",
    ],
  ])("names the problem for %s", (_name, change, path) => {
    expect(problemsOf(mutated(change)).join("\n")).toContain(path);
  });

  it("refuses repeated budget ids", () => {
    const repeated = mutated((draft) => {
      const budgets = draft.budgets as { targets: { id: string }[] };
      budgets.targets.push({ ...(budgets.targets[0] as { id: string }) });
    });

    expect(problemsOf(repeated).join()).toContain("is repeated");
  });

  it("refuses a budget of an unknown kind", () => {
    const unknownKind = mutated((draft) => {
      (draft.budgets as { targets: unknown[] }).targets.push({
        id: "x",
        description: "x",
        kind: "vibes",
        executor: "pi",
      });
    });

    expect(problemsOf(unknownKind).length).toBeGreaterThan(0);
  });
});

describe("configHash", () => {
  it("does not depend on key order", () => {
    const config = parseConfig(shippedConfig());
    const reordered = Object.fromEntries(Object.entries(config).reverse()) as BenchmarkConfig;

    expect(configHash(reordered)).toBe(configHash(config));
  });

  it("changes when a value changes", () => {
    const config = parseConfig(shippedConfig());

    expect(configHash({ ...config, samples: config.samples + 1 })).not.toBe(configHash(config));
  });
});

it("validates explicit worktree/nested/cache/wait/failure selections", () => {
  const config = JSON.parse(
    readFileSync(new URL("../../../../../e2e/runtime-benchmark.config.json", import.meta.url), "utf8"),
  );
  expect(
    parseConfig(config).cells?.some((cell) => cell.workspace === "worktree" && cell.cwd === "nested"),
  ).toBe(true);
  expect(parseConfig(config).budgets.selection).toBe("UNSELECTED");
  config.cells.push(config.cells[0]);
  expect(() => parseConfig(config)).toThrow("duplicate cell ids");
});
