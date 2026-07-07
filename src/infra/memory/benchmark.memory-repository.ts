import type { BenchmarkRun, BenchmarkRunRepository } from "@/modules/regression-benchmark";
import { BenchmarkRunId, ok } from "@/shared";

/** In-memory BenchmarkRunRepository — the offline default. */
export function createMemoryBenchmarkRunRepository(): BenchmarkRunRepository {
  const runs = new Map<string, BenchmarkRun>();

  return {
    async record(run) {
      const full: BenchmarkRun = {
        ...run,
        id: BenchmarkRunId(crypto.randomUUID()),
        createdAt: new Date(),
      };
      runs.set(full.id, full);
      return ok(full);
    },
    async list() {
      return ok(
        [...runs.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      );
    },
  };
}
