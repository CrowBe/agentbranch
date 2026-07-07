import type { DomainError, Result } from "@/shared";
import type { BenchmarkRun } from "./benchmark.types";

/**
 * Persistence port for benchmark runs. Append-only: each scoring of the frozen
 * set is one record pinned to a harness version, so the score-over-versions
 * view is a plain read. Admin-only surface — no user scoping by design.
 */
export interface BenchmarkRunRepository {
  record(run: Omit<BenchmarkRun, "id" | "createdAt">): Promise<Result<BenchmarkRun, DomainError>>;
  /** All recorded runs, newest first. */
  list(): Promise<Result<readonly BenchmarkRun[], DomainError>>;
}
