const CONFIDENCE_95 = 0.95 as const;
const Z_95 = 1.959963984540054;

export type WilsonInterval = {
  readonly method: "wilson";
  readonly version: 1;
  readonly confidence: typeof CONFIDENCE_95;
  readonly numerator: number;
  readonly denominator: number;
  readonly rate: number;
  readonly lower: number;
  readonly upper: number;
};

export type NewcombeDifferenceInterval = {
  readonly method: "newcombe-wilson";
  readonly version: 1;
  readonly confidence: typeof CONFIDENCE_95;
  readonly orientation: "with-minus-without";
  readonly with: WilsonInterval;
  readonly without: WilsonInterval;
  readonly difference: number;
  readonly lower: number;
  readonly upper: number;
};

/** Full-precision two-sided 95% Wilson score interval for one binomial rate. */
export function wilson95(numerator: number, denominator: number): WilsonInterval {
  assertBinomialCount(numerator, denominator);
  const rate = numerator / denominator;
  const z2 = Z_95 * Z_95;
  const scale = 1 + z2 / denominator;
  const centre = (rate + z2 / (2 * denominator)) / scale;
  const radius =
    (Z_95 / scale) *
    Math.sqrt((rate * (1 - rate) + z2 / (4 * denominator)) / denominator);
  return {
    method: "wilson",
    version: 1,
    confidence: CONFIDENCE_95,
    numerator,
    denominator,
    rate,
    lower: Math.max(0, centre - radius),
    upper: Math.min(1, centre + radius),
  };
}

/**
 * Newcombe's independent-proportion difference interval, oriented as
 * failRateWithRule - failRateWithoutRule and built from Wilson score bounds.
 */
export function newcombeWilsonDifference95(
  failuresWith: number,
  sizeWith: number,
  failuresWithout: number,
  sizeWithout: number,
): NewcombeDifferenceInterval {
  const withRule = wilson95(failuresWith, sizeWith);
  const withoutRule = wilson95(failuresWithout, sizeWithout);
  const difference = withRule.rate - withoutRule.rate;
  const lower =
    difference -
    Math.sqrt(
      (withRule.rate - withRule.lower) ** 2 +
      (withoutRule.upper - withoutRule.rate) ** 2,
    );
  const upper =
    difference +
    Math.sqrt(
      (withRule.upper - withRule.rate) ** 2 +
      (withoutRule.rate - withoutRule.lower) ** 2,
    );
  return {
    method: "newcombe-wilson",
    version: 1,
    confidence: CONFIDENCE_95,
    orientation: "with-minus-without",
    with: withRule,
    without: withoutRule,
    difference,
    lower: Math.max(-1, lower),
    upper: Math.min(1, upper),
  };
}

function assertBinomialCount(numerator: number, denominator: number): void {
  if (
    !Number.isInteger(numerator) ||
    !Number.isInteger(denominator) ||
    denominator <= 0 ||
    numerator < 0 ||
    numerator > denominator
  ) {
    throw new RangeError("Binomial counts require integers with 0 <= numerator <= denominator.");
  }
}
