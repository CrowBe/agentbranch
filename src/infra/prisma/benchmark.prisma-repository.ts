import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  BenchmarkRun,
  BenchmarkRunRepository,
  BenchmarkScore,
} from "@/modules/regression-benchmark";
import {
  BenchmarkRunId,
  HarnessVersionId,
  domainError,
  err,
  ok,
  wilson95,
} from "@/shared";

type BenchmarkRunRow = {
  id: string;
  harnessVersionId: string;
  benchmarkSetHash: string;
  scoreJson: unknown;
  createdAt: Date;
};

function toBenchmarkRun(row: BenchmarkRunRow): BenchmarkRun {
  const score = row.scoreJson as Omit<BenchmarkScore, "benchmarkSetHash">;
  const attempts = score.attempts ?? 1;
  const totalAttempts = score.totalAttempts ?? score.totalCases;
  const passedAttempts = score.passedAttempts ?? score.passedCases;
  const attemptPassRateInterval =
    score.attemptPassRateInterval ?? wilson95(passedAttempts, totalAttempts);
  return {
    id: BenchmarkRunId(row.id),
    harnessVersionId: HarnessVersionId(row.harnessVersionId),
    benchmarkSetHash: row.benchmarkSetHash,
    totalCases: score.totalCases,
    passedCases: score.passedCases,
    attempts,
    totalAttempts,
    passedAttempts,
    attemptPassRateInterval,
    score: score.score,
    perSkill: score.perSkill.map((skill) => ({
      ...skill,
      totalAttempts: skill.totalAttempts ?? skill.totalCases,
      passedAttempts: skill.passedAttempts ?? skill.passedCases,
    })),
    dimensions: score.dimensions,
    createdAt: row.createdAt,
  };
}

/** Prisma BenchmarkRunRepository (real). Persists frozen-set scorings. */
export function createPrismaBenchmarkRunRepository(
  prisma: PrismaClient,
): BenchmarkRunRepository {
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
              attempts: run.attempts,
              totalAttempts: run.totalAttempts,
              passedAttempts: run.passedAttempts,
              attemptPassRateInterval: run.attemptPassRateInterval,
              score: run.score,
              perSkill: run.perSkill,
              dimensions: run.dimensions,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        return ok(toBenchmarkRun(row as BenchmarkRunRow));
      } catch (cause) {
        return err(
          domainError(
            "persistence_failed",
            "A benchmark run could not be recorded.",
            cause,
          ),
        );
      }
    },

    async list() {
      try {
        const rows = await prisma.benchmarkRun.findMany({
          orderBy: { createdAt: "desc" },
        });
        return ok(rows.map((row) => toBenchmarkRun(row as BenchmarkRunRow)));
      } catch (cause) {
        return err(
          domainError(
            "persistence_failed",
            "Benchmark runs could not be listed.",
            cause,
          ),
        );
      }
    },
  };
}
