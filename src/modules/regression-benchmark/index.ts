/**
 * regression-benchmark — the harness improvement loop's measurement guardrail
 * (ARCHITECTURE §9, #118/#123). To claim harness vN+1 beats vN you hold the
 * test fixed and vary the harness: the frozen set is the baseline skill corpus
 * with its curated batteries, and each scoring is recorded pinned to the
 * harness version in effect, so two manifest versions compare on identical
 * ground. Admin-only, `platform`-tagged; not a capability on the seam — it
 * scores the seam's triggering eval from outside.
 */
export type { BenchmarkEntry } from "./benchmark-set";
export { regressionBenchmarkSet, regressionBenchmarkSetHash } from "./benchmark-set";
export type {
  BenchmarkRun,
  BenchmarkScore,
  BenchmarkSkillScore,
} from "./benchmark.types";
export type { BenchmarkRunRepository } from "./benchmark.repository";
export { runRegressionBenchmark } from "./run-benchmark";
