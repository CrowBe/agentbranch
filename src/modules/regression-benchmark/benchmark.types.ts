import type { SafetyReviewClass, SafetyReviewVerdict } from "@/modules/safety-review";
import type { BenchmarkRunId, HarnessVersionId, WilsonInterval } from "@/shared";

/** One corpus skill's slice of a benchmark score. */
export type BenchmarkSkillScore = {
  readonly corpusEntryId: string;
  /** The corpus entry's content hash — proves what was scored. */
  readonly contentHash: string;
  readonly totalCases: number;
  readonly passedCases: number;
  readonly totalAttempts: number;
  readonly passedAttempts: number;
};

/**
 * One scoring of the frozen set. Scores are comparable only within the same
 * `benchmarkSetHash` — a changed corpus is a different benchmark, not a
 * better/worse harness (ARCHITECTURE §9).
 */
export type BenchmarkScore = {
  readonly benchmarkSetHash: string;
  readonly totalCases: number;
  readonly passedCases: number;
  readonly attempts: number;
  readonly totalAttempts: number;
  readonly passedAttempts: number;
  /** Stochastic attempt pass rate with its full-precision 95% Wilson interval. */
  readonly attemptPassRateInterval: WilsonInterval;
  /** passedCases / totalCases, 0..1. */
  readonly score: number;
  readonly perSkill: readonly BenchmarkSkillScore[];
  readonly dimensions: {
    readonly responseSchema: BenchmarkDimensionScore;
    readonly toolContract: BenchmarkDimensionScore;
    readonly safety: BenchmarkDimensionScore;
    /**
     * The badge's judge, scored live. Optional because runs recorded before
     * the dimension existed carry no score for it, and a model-bearing result
     * cannot be honestly reconstructed after the fact (ARCHITECTURE §9).
     */
    readonly safetyJudge?: SafetyJudgeBenchmarkDimensionScore;
    readonly taskOutcome: TaskOutcomeBenchmarkDimensionScore;
  };
};

export type BenchmarkDimensionEntryScore = {
  readonly corpusEntryId: string;
  readonly contentHash: string;
  readonly passed: boolean;
};

export type BenchmarkDimensionScore = {
  readonly benchmarkSetHash: string;
  readonly totalCases: number;
  readonly passedCases: number;
  readonly score: number;
  readonly entries: readonly BenchmarkDimensionEntryScore[];
};

export type TaskOutcomeBenchmarkDimensionScore = BenchmarkDimensionScore & {
  readonly attempts: number;
  readonly totalAttempts: number;
  readonly passedAttempts: number;
  readonly attemptPassRate: number;
  readonly attemptPassRateInterval: WilsonInterval;
  readonly method: {
    readonly kind: "model";
    readonly grader: "json-output";
    readonly graderVersion: 1;
    readonly method: "generate-then-schema-validate";
    readonly methodVersion: 1;
    readonly attemptsPerCase: number;
  };
};

/**
 * The two cohorts the safety judge is scored on. Detection alone is not a
 * score: a judge that blocks everything catches every adversarial case, so the
 * benign controls carry the cost of over-blocking.
 */
export type SafetyJudgeCohort = "adversarial" | "benign-control";

/** One live reading of the judge on one case. */
export type SafetyJudgeObservation = {
  readonly verdict: SafetyReviewVerdict;
  readonly classScores: Readonly<Record<SafetyReviewClass, number>>;
};

export type SafetyJudgeEntryScore = BenchmarkDimensionEntryScore & {
  readonly cohort: SafetyJudgeCohort;
  readonly expectedVerdict: SafetyReviewVerdict;
  readonly attempts: number;
  readonly passedAttempts: number;
  /** Retained so over-blocking stays visible instead of scoring as a win. */
  readonly observations: readonly SafetyJudgeObservation[];
};

/**
 * A case §9.1 accepts as undetectable (the latent payloads): observed, never
 * scored. Counting a lucky catch here would inflate the rate.
 */
export type SafetyJudgeNonDetection = {
  readonly corpusEntryId: string;
  readonly contentHash: string;
  readonly observations: readonly SafetyJudgeObservation[];
};

export type SafetyJudgeCohortScore = {
  readonly totalCases: number;
  readonly passedCases: number;
  readonly score: number;
  readonly totalAttempts: number;
  readonly passedAttempts: number;
  readonly attemptPassRate: number;
  readonly attemptPassRateInterval: WilsonInterval;
};

/**
 * The model-bearing scoring of `runSafetyReview` — the layer that decides the
 * safety badge (ARCHITECTURE §9.1). Sits beside the deterministic `safety`
 * dimension, which scores the static policy rules.
 */
export type SafetyJudgeBenchmarkDimensionScore = Omit<
  BenchmarkDimensionScore,
  "entries"
> & {
  readonly entries: readonly SafetyJudgeEntryScore[];
  readonly attempts: number;
  readonly totalAttempts: number;
  readonly passedAttempts: number;
  readonly attemptPassRate: number;
  readonly attemptPassRateInterval: WilsonInterval;
  readonly cohorts: Readonly<Record<SafetyJudgeCohort, SafetyJudgeCohortScore>>;
  readonly documentedNonDetections: readonly SafetyJudgeNonDetection[];
  readonly method: {
    readonly kind: "model";
    readonly grader: "safety-verdict";
    readonly graderVersion: 1;
    /**
     * Adversarial cases pass at or above the expected severity, benign
     * controls at or below it.
     */
    readonly method: "cohort-severity-bound";
    readonly methodVersion: 1;
    readonly attemptsPerCase: number;
  };
};

/** A persisted benchmark run, pinned to the harness version it scored. */
export type BenchmarkRun = BenchmarkScore & {
  readonly id: BenchmarkRunId;
  readonly harnessVersionId: HarnessVersionId;
  readonly createdAt: Date;
};
