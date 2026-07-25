import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { unwrap } from "@/shared";
import { createPrismaEvalRunRepository } from "./eval.prisma-repository";

describe("Prisma eval run repository", () => {
  it("normalizes a persisted v1 result for admin analysis reads", async () => {
    const row = {
      id: "eval-1",
      skillId: "skill-1",
      skillVersionId: "version-1",
      harnessVersionId: "harness-1",
      userId: "user-1",
      status: "passed",
      resultJson: {
        kind: "triggering-eval",
        passed: true,
        cases: [{
          prompt: "legacy prompt",
          expected: "fire",
          actual: "fire",
          pass: true,
          rationale: "legacy rationale",
        }],
        insight: { verdict: "good", summary: "legacy", findings: [], watch: [] },
      },
      createdAt: new Date("2026-01-01T00:00:00Z"),
      skillVersion: { lintSummaryJson: null },
    };
    const findMany = vi.fn().mockResolvedValue([row]);
    const prisma = { evalRun: { findMany } } as unknown as PrismaClient;
    const repo = createPrismaEvalRunRepository(prisma);

    const records = unwrap(await repo.listForAnalysis());

    expect(records).toEqual([
      expect.objectContaining({
        attempts: 1,
        totalAttempts: 1,
        passedAttempts: 1,
        cases: [{
          grader: "selection",
          caseId: "a7c0b417dd8d71c1d1b9d78c3223b1f7391c06531c23e33e3d29efc5aead7387",
          expected: "fire",
          observed: {
            grader: "selection",
            actual: "fire",
            rationale: "legacy rationale",
          },
          pass: true,
          attempts: 1,
          passedAttempts: 1,
          passRate: 1,
        }],
      }),
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { skillVersion: { select: { lintSummaryJson: true } } },
      }),
    );
  });
});
