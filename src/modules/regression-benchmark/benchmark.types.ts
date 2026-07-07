import type { BenchmarkRunId, HarnessVersionId } from "@/shared";

/** One corpus skill's slice of a benchmark score. */
export type BenchmarkSkillScore = {
  readonly corpusEntryId: string;
  /** The corpus entry's content hash — proves what was scored. */
  readonly contentHash: string;
  readonly totalCases: number;
  readonly passedCases: number;
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
  /** passedCases / totalCases, 0..1. */
  readonly score: number;
  readonly perSkill: readonly BenchmarkSkillScore[];
};

/** A persisted benchmark run, pinned to the harness version it scored. */
export type BenchmarkRun = BenchmarkScore & {
  readonly id: BenchmarkRunId;
  readonly harnessVersionId: HarnessVersionId;
  readonly createdAt: Date;
};
