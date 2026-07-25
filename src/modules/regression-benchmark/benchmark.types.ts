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

/** A persisted benchmark run, pinned to the harness version it scored. */
export type BenchmarkRun = BenchmarkScore & {
  readonly id: BenchmarkRunId;
  readonly harnessVersionId: HarnessVersionId;
  readonly createdAt: Date;
};
