import { describe, expect, it } from "vitest";
import { newcombeWilsonDifference95, wilson95 } from "./binomial-statistics";

describe("binomial statistics", () => {
  it.each([
    [0, 10, 0, 0.2775327998628892],
    [5, 10, 0.236593090512564, 0.7634069094874361],
    [10, 10, 0.7224672001371107, 1],
  ])("matches reference Wilson values for %i/%i", (successes, total, lower, upper) => {
    expect(wilson95(successes, total)).toMatchObject({
      method: "wilson",
      version: 1,
      confidence: 0.95,
      numerator: successes,
      denominator: total,
      lower: expect.closeTo(lower, 12),
      upper: expect.closeTo(upper, 12),
    });
  });

  it("narrows at a fixed observed rate as the denominator increases", () => {
    const small = wilson95(5, 10);
    const large = wilson95(50, 100);
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });

  it("builds an oriented independent-cohort Newcombe interval", () => {
    const interval = newcombeWilsonDifference95(9, 10, 1, 10);
    expect(interval).toMatchObject({
      method: "newcombe-wilson",
      version: 1,
      confidence: 0.95,
      orientation: "with-minus-without",
      difference: 0.8,
      with: { numerator: 9, denominator: 10, rate: 0.9 },
      without: { numerator: 1, denominator: 10, rate: 0.1 },
    });
    expect(interval.lower).toBeGreaterThan(0);
    expect(interval.upper).toBeLessThanOrEqual(1);
  });

  it("rejects impossible counts", () => {
    expect(() => wilson95(1, 0)).toThrow(RangeError);
    expect(() => wilson95(3, 2)).toThrow(RangeError);
    expect(() => wilson95(0.5, 1)).toThrow(RangeError);
  });
});
