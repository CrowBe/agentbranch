import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  responseSchemaBenchmarkSetHash,
  safetyBenchmarkSetHash,
  toolContractBenchmarkSetHash,
} from "@/modules/regression-benchmark";
import { taskOutcomeCorpusSetHash } from "@/modules/task-outcome-corpus";
import { HarnessVersionId, unwrap, wilson95 } from "@/shared";
import { createPrismaBenchmarkRunRepository } from "./benchmark.prisma-repository";

const createdAt = new Date("2026-07-26T00:00:00Z");

describe("Prisma benchmark repository uncertainty metadata", () => {
  it("persists the full-precision Wilson method and counts", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "run-1",
      harnessVersionId: data.harnessVersionId,
      benchmarkSetHash: data.benchmarkSetHash,
      scoreJson: data.scoreJson,
      createdAt,
    }));
    const repository = createPrismaBenchmarkRunRepository({
      benchmarkRun: { create, findMany: vi.fn() },
    } as unknown as PrismaClient);
    const interval = wilson95(7, 9);

    const recorded = unwrap(await repository.record({
      harnessVersionId: HarnessVersionId("h1"),
      benchmarkSetHash: "set-1",
      totalCases: 3,
      passedCases: 2,
      attempts: 3,
      totalAttempts: 9,
      passedAttempts: 7,
      attemptPassRateInterval: interval,
      score: 2 / 3,
      perSkill: [],
      dimensions: dimensions(),
    }));

    expect(recorded.attemptPassRateInterval).toEqual(interval);
    expect(create.mock.calls[0]?.[0].data.scoreJson).toMatchObject({
      attemptPassRateInterval: interval,
    });
  });

  it("reconstructs Wilson metadata for legacy benchmark JSON", async () => {
    const findMany = vi.fn(async () => [{
      id: "legacy",
      harnessVersionId: "h1",
      benchmarkSetHash: "set-1",
      scoreJson: {
        totalCases: 10,
        passedCases: 7,
        score: 0.7,
        perSkill: [],
        dimensions: dimensions(),
      },
      createdAt,
    }]);
    const repository = createPrismaBenchmarkRunRepository({
      benchmarkRun: { create: vi.fn(), findMany },
    } as unknown as PrismaClient);

    const [legacy] = unwrap(await repository.list());

    expect(legacy?.attemptPassRateInterval).toEqual(wilson95(7, 10));
    expect(legacy).toMatchObject({
      attempts: 1,
      totalAttempts: 10,
      passedAttempts: 7,
    });
  });
});

function dimensions() {
  return {
    responseSchema: emptyDimension(responseSchemaBenchmarkSetHash),
    toolContract: emptyDimension(toolContractBenchmarkSetHash),
    safety: emptyDimension(safetyBenchmarkSetHash),
    taskOutcome: {
      ...emptyDimension(taskOutcomeCorpusSetHash),
      method: {
        kind: "model" as const,
        grader: "json-output" as const,
        graderVersion: 1 as const,
        method: "generate-then-schema-validate" as const,
        methodVersion: 1 as const,
      },
    },
  };
}

function emptyDimension(benchmarkSetHash: string) {
  return { benchmarkSetHash, totalCases: 0, passedCases: 0, score: 0, entries: [] };
}
