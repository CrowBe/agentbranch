import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { EvalRunId, UserId, isErr, unwrap } from "@/shared";
import { triggeringCaseId, triggeringEvaluationSetHash } from "@/modules/triggering-eval";
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
          caseId: "untrusted-legacy-id",
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

  it.each([
    ["unknown grader", { grader: "llm-judge" }],
    [
      "corrupt current selection",
      {
        grader: "selection",
        prompt: "current",
        expected: "fire",
        pass: true,
        observed: { grader: "selection", actual: "fire", rationale: "ok" },
      },
    ],
    [
      "corrupt current JSON-output",
      {
        grader: "json-output",
        graderVersion: 1,
        prompt: "current",
        expectedSchema: { type: "object" },
        pass: true,
        observed: { grader: "json-output", output: {}, validationIssues: [] },
      },
    ],
  ])("rejects %s persisted cases instead of inventing defaults", async (_, storedCase) => {
    const prisma = {
      evalRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "eval-bad",
          skillId: "skill-1",
          skillVersionId: null,
          harnessVersionId: null,
          userId: "user-1",
          status: "failed",
          resultJson: {
            kind: "triggering-eval",
            passed: false,
            attempts: 1,
            totalAttempts: 1,
            passedAttempts: 0,
            cases: [storedCase],
            insight: { verdict: "failing", summary: "bad", findings: [], watch: [] },
          },
          createdAt: new Date(),
        }),
      },
    } as unknown as PrismaClient;
    const result = await createPrismaEvalRunRepository(prisma).findById(
      EvalRunId("eval-bad"),
      UserId("user-1"),
    );
    expect(isErr(result) && result.error.tag).toBe("persistence_failed");
  });

  it.each([
    ["root kind", (value: ReturnType<typeof currentResult>) => ({ ...value, kind: "other" })],
    ["root pass", (value: ReturnType<typeof currentResult>) => ({ ...value, passed: false })],
    ["root insight", (value: ReturnType<typeof currentResult>) => ({ ...value, insight: { verdict: "good" } })],
    ["even attempts", (value: ReturnType<typeof currentResult>) => ({ ...value, attempts: 2 })],
    ["total mismatch", (value: ReturnType<typeof currentResult>) => ({ ...value, totalAttempts: 4 })],
    ["passed total mismatch", (value: ReturnType<typeof currentResult>) => ({ ...value, passedAttempts: 3 })],
    ["case rate", (value: ReturnType<typeof currentResult>) => ({
      ...value,
      cases: [{ ...value.cases[0], passRate: 0.5 }],
    })],
    ["case pass", (value: ReturnType<typeof currentResult>) => ({
      ...value,
      cases: [{ ...value.cases[0], pass: false }],
    })],
    ["case id", (value: ReturnType<typeof currentResult>) => ({
      ...value,
      cases: [{ ...value.cases[0], caseId: "wrong" }],
    })],
    ["case counts", (value: ReturnType<typeof currentResult>) => ({
      ...value,
      cases: [{ ...value.cases[0], passedAttempts: 4 }],
    })],
  ])("rejects corrupt current %s through the repository boundary", async (_, corrupt) => {
    const prisma = {
      evalRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "eval-corrupt",
          skillId: "skill-1",
          skillVersionId: null,
          harnessVersionId: null,
          userId: "user-1",
          status: "passed",
          resultJson: corrupt(currentResult()),
          createdAt: new Date(),
        }),
      },
    } as unknown as PrismaClient;
    const result = await createPrismaEvalRunRepository(prisma).findById(
      EvalRunId("eval-corrupt"),
      UserId("user-1"),
    );
    expect(isErr(result) && result.error.tag).toBe("persistence_failed");
  });

  it("preserves valid current comparison metadata after complete validation", async () => {
    const prisma = {
      evalRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "eval-current",
          skillId: "skill-1",
          skillVersionId: null,
          harnessVersionId: null,
          userId: "user-1",
          status: "passed",
          resultJson: currentResult(),
          createdAt: new Date(),
        }),
      },
    } as unknown as PrismaClient;
    const run = unwrap(await createPrismaEvalRunRepository(prisma).findById(
      EvalRunId("eval-current"),
      UserId("user-1"),
    ));
    expect(run?.result.comparisonMetadata).toEqual(currentResult().comparisonMetadata);
  });

  it.each([
    ["kind", (value: ReturnType<typeof legacyResult>) => ({ ...value, kind: "other" })],
    ["pass", (value: ReturnType<typeof legacyResult>) => ({ ...value, passed: false })],
    ["insight", (value: ReturnType<typeof legacyResult>) => ({ ...value, insight: null })],
    ["attempts", (value: ReturnType<typeof legacyResult>) => ({ ...value, attempts: 2 })],
    ["totalAttempts", (value: ReturnType<typeof legacyResult>) => ({ ...value, totalAttempts: 2 })],
    ["passedAttempts", (value: ReturnType<typeof legacyResult>) => ({ ...value, passedAttempts: 0 })],
    ["case passRate", (value: ReturnType<typeof legacyResult>) => ({
      ...value,
      cases: [{ ...value.cases[0], passRate: 0.5 }],
    })],
    ["case counts", (value: ReturnType<typeof legacyResult>) => ({
      ...value,
      cases: [{ ...value.cases[0], passedAttempts: 2 }],
    })],
  ])("rejects corrupt supplied legacy %s", async (_, corrupt) => {
    const result = await repositoryResult(corrupt(legacyResult()));
    expect(isErr(result) && result.error.tag).toBe("persistence_failed");
  });

  it("rejects selection comparison metadata on a current JSON-output result", async () => {
    const value = jsonCurrentResult();
    const result = await repositoryResult({
      ...value,
      comparisonMetadata: currentResult().comparisonMetadata,
    });
    expect(isErr(result) && result.error.tag).toBe("persistence_failed");
  });

  it("rejects selection comparison metadata with the wrong ordered case hash", async () => {
    const value = currentResult();
    const result = await repositoryResult({
      ...value,
      comparisonMetadata: { ...value.comparisonMetadata, evaluationSetHash: "wrong" },
    });
    expect(isErr(result) && result.error.tag).toBe("persistence_failed");
  });
});

function repositoryResult(resultJson: unknown) {
  const prisma = {
    evalRun: {
      findFirst: vi.fn().mockResolvedValue({
        id: "eval-probe",
        skillId: "skill-1",
        skillVersionId: null,
        harnessVersionId: null,
        userId: "user-1",
        status: "failed",
        resultJson,
        createdAt: new Date(),
      }),
    },
  } as unknown as PrismaClient;
  return createPrismaEvalRunRepository(prisma).findById(
    EvalRunId("eval-probe"),
    UserId("user-1"),
  );
}

function legacyResult() {
  return {
    kind: "triggering-eval" as const,
    passed: true,
    attempts: 1,
    totalAttempts: 1,
    passedAttempts: 1,
    cases: [{
      prompt: "legacy",
      expected: "fire" as const,
      actual: "fire" as const,
      pass: true,
      rationale: "legacy",
      attempts: 1,
      passedAttempts: 1,
      passRate: 1,
    }],
    insight: { verdict: "good" as const, summary: "legacy", findings: [], watch: [] },
  };
}

function jsonCurrentResult() {
  const promptCase = {
    grader: "json-output" as const,
    graderVersion: 1 as const,
    prompt: "return json",
    expectedSchema: { type: "object" },
  };
  return {
    kind: "triggering-eval" as const,
    passed: true,
    attempts: 1,
    totalAttempts: 1,
    passedAttempts: 1,
    cases: [{
      ...promptCase,
      caseId: triggeringCaseId(promptCase),
      observed: { grader: "json-output" as const, output: {}, validationIssues: [] },
      pass: true,
      attempts: 1,
      passedAttempts: 1,
      passRate: 1,
    }],
    insight: { verdict: "good" as const, summary: "json", findings: [], watch: [] },
  };
}

function currentResult() {
  const promptCase = {
    grader: "selection" as const,
    prompt: "current prompt",
    expected: "fire" as const,
  };
  const cases = [{
    ...promptCase,
    caseId: triggeringCaseId(promptCase),
    observed: { grader: "selection" as const, actual: "fire" as const, rationale: "current" },
    pass: true,
    attempts: 3,
    passedAttempts: 2,
    passRate: 2 / 3,
  }];
  return {
    kind: "triggering-eval" as const,
    passed: true,
    attempts: 3,
    totalAttempts: 3,
    passedAttempts: 2,
    comparisonMetadata: {
      evaluationSetHash: triggeringEvaluationSetHash(cases),
      grader: "selection" as const,
      graderVersion: 1 as const,
      method: "competitive-selection" as const,
      methodVersion: 1 as const,
    },
    cases,
    insight: { verdict: "good" as const, summary: "valid", findings: [], watch: [] },
  };
}
