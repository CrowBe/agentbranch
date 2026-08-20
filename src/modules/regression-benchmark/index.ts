/**
 * regression-benchmark — the harness improvement loop's measurement guardrail
 * (ARCHITECTURE §9, #118/#123). To claim harness vN+1 beats vN you hold the
 * test fixed and vary the harness: the frozen set is the baseline skill corpus
 * with its curated batteries, and each scoring is recorded pinned to the
 * harness version in effect, so two manifest versions compare on identical
 * ground. Admin-only, `platform`-tagged; not a capability on the seam — it
 * scores the seam's triggering eval from outside.
 */
export type { BenchmarkEntry, SafetyJudgeBenchmarkEntry } from "./benchmark-set";
export {
  regressionBenchmarkSet,
  regressionBenchmarkSetHash,
  responseSchemaBenchmarkSet,
  responseSchemaBenchmarkSetHash,
  toolContractBenchmarkSet,
  toolContractBenchmarkSetHash,
  safetyBenchmarkSet,
  safetyBenchmarkSetHash,
  safetyJudgeBenchmarkSet,
  safetyJudgeBenchmarkSetHash,
  canonicalBenchmarkCase,
} from "./benchmark-set";
export type {
  BenchmarkDimensionEntryScore,
  BenchmarkDimensionScore,
  BenchmarkRun,
  BenchmarkScore,
  BenchmarkSkillScore,
  SafetyJudgeBenchmarkDimensionScore,
  SafetyJudgeCohort,
  SafetyJudgeCohortScore,
  SafetyJudgeEntryScore,
  SafetyJudgeNonDetection,
  SafetyJudgeObservation,
  TaskOutcomeBenchmarkDimensionScore,
} from "./benchmark.types";
export type { BenchmarkRunRepository } from "./benchmark.repository";
export { runRegressionBenchmark } from "./run-benchmark";
export { runSafetyJudgeBenchmarkDimension } from "./run-safety-judge-dimension";
export { runTaskOutcomeBenchmarkDimension } from "./run-task-outcome-dimension";
