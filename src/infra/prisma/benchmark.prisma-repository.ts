import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  BenchmarkRun,
  BenchmarkRunRepository,
  BenchmarkScore,
} from "@/modules/regression-benchmark";
import { BenchmarkRunId, HarnessVersionId, domainError, err, ok } from "@/shared";

type BenchmarkRunRow = {
  id: string;
  harnessVersionId: string;
  benchmarkSetHash: string;
  scoreJson: unknown;
  createdAt: Date;
};

function toBenchmarkRun(row: BenchmarkRunRow): BenchmarkRun {
  const score = row.scoreJson as Omit<BenchmarkScore, "benchmarkSetHash">;
  return {
    id: BenchmarkRunId(row.id),
    harnessVersionId: HarnessVersionId(row.harnessVersionId),
    benchmarkSetHash: row.benchmarkSetHash,
    totalCases: score.totalCases,
    passedCases: score.passedCases,
    score: score.score,
    perSkill: score.perSkill,
    createdAt: row.createdAt,
  };
}

/** Prisma BenchmarkRunRepository (real). Persists frozen-set scorings. */
export function createPrismaBenchmarkRunRepository(prisma: PrismaClient): BenchmarkRunRepository {
  return {
    async record(run) {
      try {
        const row = await prisma.benchmarkRun.create({
          data: {
            harnessVersionId: run.harnessVersionId,
            benchmarkSetHash: run.benchmarkSetHash,
            scoreJson: {
              totalCases: run.totalCases,
              passedCases: run.passedCases,
              score: run.score,
              perSkill: run.perSkill,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        return ok(toBenchmarkRun(row as BenchmarkRunRow));
      } catch (cause) {
        return err(
          domainError("persistence_failed", "A benchmark run could not be recorded.", cause),
        );
      }
    },

    async list() {
      try {
        const rows = await prisma.benchmarkRun.findMany({ orderBy: { createdAt: "desc" } });
        return ok(rows.map((row) => toBenchmarkRun(row as BenchmarkRunRow)));
      } catch (cause) {
        return err(
          domainError("persistence_failed", "Benchmark runs could not be listed.", cause),
        );
      }
    },
  };
}
