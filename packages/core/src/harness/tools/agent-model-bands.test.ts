import { describe, expect, it } from "vitest";
import { type Band, bandsOf } from "./agent-model-bands";

const priced = (...prices: number[]) => prices.map((price) => ({ cost: { input: price, output: 0 } }));
const L = "light";
const M = "mid";
const H = "heavy";

describe("bandsOf", () => {
  const cases: [string, number[], Band[]][] = [
    ["nothing to split", [1, 1, 1, 1, 1, 1], [M, M, M, M, M, M]],
    ["two of each", [1, 1, 5, 5, 20, 20], [L, L, M, M, H, H]],
    ["fewer than four", [1, 2, 3], [M, M, M]],
    ["a big tie group in the middle", [1, 1, 5, 5, 5, 5], [L, L, M, M, M, M]],
    ["seven models", [1, 1, 1, 5, 5, 5, 20], [L, L, L, M, M, M, H]],
    ["a cheap model and a dear tie group", [1, 5, 5, 5, 5, 5], [L, L, L, L, L, L]],
  ];
  for (const [name, prices, expected] of cases) {
    it(name, () => expect(bandsOf(priced(...prices))).toEqual(expected));
  }

  it("labels only free models free", () => {
    const free = { cost: { input: 0, output: 0 } };
    expect(bandsOf([free, free])).toEqual(["free", "free"]);
  });

  it("labels models without cost unpriced", () => {
    expect(bandsOf([{}, {}])).toEqual(["unpriced", "unpriced"]);
  });

  it("keeps free and unpriced out of the priced split", () => {
    const mixed = [{ cost: { input: 0, output: 0 } }, {}, ...priced(1, 1, 5, 5, 20, 20)];
    expect(bandsOf(mixed)).toEqual(["free", "unpriced", L, L, M, M, H, H]);
  });
});
