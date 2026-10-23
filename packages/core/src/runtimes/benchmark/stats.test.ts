import { describe, expect, it } from "vitest";
import { MIN_SAMPLES_FOR_PERCENTILES, medianOf, nearestRank, summarize } from "./stats";

const ONE_TO = (count: number): number[] => Array.from({ length: count }, (_, index) => index + 1);

describe("nearestRank", () => {
  it("picks the ceil(p * n)th smallest value", () => {
    const hundred = ONE_TO(100);

    expect(nearestRank(hundred, 0.5)).toBe(50);
    expect(nearestRank(hundred, 0.95)).toBe(95);
    expect(nearestRank(ONE_TO(20), 0.95)).toBe(19);
    expect(nearestRank([7], 0.95)).toBe(7);
  });

  it("refuses an empty list", () => {
    expect(() => nearestRank([], 0.5)).toThrow("no samples");
  });
});

describe("medianOf", () => {
  it("averages the middle pair of an even list", () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
    expect(medianOf([1, 2, 9])).toBe(2);
  });
});

describe("summarize", () => {
  it("reports no samples as such, never as zero", () => {
    expect(summarize([])).toMatchObject({ count: 0, min: null, p95: null, percentileStatus: "no-samples" });
  });

  it("gives min, median and max but no percentiles below the sample floor", () => {
    const summary = summarize([30, 10, 20]);

    expect(summary).toEqual({
      count: 3,
      min: 10,
      median: 20,
      max: 30,
      p50: null,
      p95: null,
      percentileStatus: "insufficient-samples",
    });
  });

  it("reports p50 and p95 from exactly the sample floor", () => {
    const shuffled = ONE_TO(MIN_SAMPLES_FOR_PERCENTILES).reverse();

    const summary = summarize(shuffled);

    expect(summary).toMatchObject({
      count: 20,
      p50: 10,
      p95: 19,
      max: 20,
      min: 1,
      percentileStatus: "reported",
    });
  });

  it("does not mutate its input and rounds to thousandths of a millisecond", () => {
    const input = [3.123456, 1.000049, 2];

    const summary = summarize(input);

    expect(input).toEqual([3.123456, 1.000049, 2]);
    expect(summary.max).toBe(3.123);
    expect(summary.min).toBe(1);
  });
});
