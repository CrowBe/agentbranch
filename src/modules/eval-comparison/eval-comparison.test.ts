import { describe, expect, it, vi } from "vitest";
import type {
  ComparableEvalRun,
  EvalRunRepository,
  TriggeringResult,
} from "@/modules/triggering-eval";
import {
  EvalRunId,
  HarnessVersionId,
  SkillBranchId,
  SkillId,
  SkillVersionId,
  UserId,
  ok,
  unwrap,
} from "@/shared";
import { compareEvalRuns } from "./compare-eval-runs";

const userId = UserId("u1");

describe("paired evaluation comparison", () => {
  it("is reproducible, prompt-free, and oriented right minus left", async () => {
    const left = run("left", "v-left", "branch-left", [0, 0]);
    const right = run("right", "v-right", "branch-right", [1, 1]);
    const repository = repositoryFor([left, right]);

    const first = unwrap(await compareEvalRuns(repository, userId, left.id, right.id));
    const again = unwrap(await compareEvalRuns(repository, userId, left.id, right.id));

    expect(first).toEqual(again);
    expect(first).toMatchObject({
      comparable: true,
      method: "paired-case-cluster-bootstrap",
      methodVersion: 1,
      confidence: 0.95,
      resamples: 10_000,
      left: { skillVersionId: "v-left", branchId: "branch-left" },
      right: { skillVersionId: "v-right", branchId: "branch-right" },
      cases: [
        { caseId: "case-1", leftRate: 0, rightRate: 1, delta: 1 },
        { caseId: "case-2", leftRate: 0, rightRate: 1, delta: 1 },
      ],
      aggregate: { delta: 1, lower: 1, upper: 1 },
      verdict: "improved",
    });
    expect(JSON.stringify(first)).not.toContain("private prompt");
    expect(repository.record).not.toHaveBeenCalled();
  });

  it("reversing sides negates deltas and flips a directional verdict", async () => {
    const left = run("left", "v-left", "b-left", [0, 0]);
    const right = run("right", "v-right", "b-right", [1, 1]);
    const repository = repositoryFor([left, right]);

    const forward = unwrap(await compareEvalRuns(repository, userId, left.id, right.id));
    const reverse = unwrap(await compareEvalRuns(repository, userId, right.id, left.id));

    expect(forward.comparable && forward.verdict).toBe("improved");
    expect(reverse.comparable && reverse.verdict).toBe("regressed");
    if (forward.comparable && reverse.comparable) {
      expect(reverse.cases.map((item) => item.delta))
        .toEqual(forward.cases.map((item) => -item.delta));
      expect(reverse.aggregate.delta).toBe(-forward.aggregate.delta);
    }
  });

  it("reports a zero-crossing aggregate as not distinguishable", async () => {
    const left = run("left", "v-left", "b-left", [0, 1]);
    const right = run("right", "v-right", "b-right", [1, 0]);
    const result = unwrap(
      await compareEvalRuns(repositoryFor([left, right]), userId, left.id, right.id),
    );
    expect(result.comparable && result.verdict).toBe("not-distinguishable");
    if (result.comparable) {
      expect(result.aggregate).toMatchObject({ delta: 0 });
      expect(result.aggregate.lower).toBeLessThanOrEqual(0);
      expect(result.aggregate.upper).toBeGreaterThanOrEqual(0);
    }
  });

  it.each([
    ["legacy-metadata", (value: ComparableEvalRun) => ({
      ...value,
      result: { ...value.result, comparisonMetadata: undefined },
    })],
    ["different-skill", (value: ComparableEvalRun) => ({ ...value, skillId: SkillId("other") })],
    ["missing-version", (value: ComparableEvalRun) => ({ ...value, skillVersionId: null })],
    ["missing-branch", (value: ComparableEvalRun) => ({ ...value, branchId: null })],
    ["different-evaluation-set", (value: ComparableEvalRun) => ({
      ...value,
      result: {
        ...value.result,
        comparisonMetadata: { ...value.result.comparisonMetadata!, evaluationSetHash: "other" },
      },
    })],
    ["different-case-order", (value: ComparableEvalRun) => ({
      ...value,
      result: { ...value.result, cases: [...value.result.cases].reverse() },
    })],
    ["different-attempts", (value: ComparableEvalRun) => ({
      ...value,
      result: { ...value.result, attempts: 3 },
    })],
    ["different-grader", (value: ComparableEvalRun) => ({
      ...value,
      result: {
        ...value.result,
        comparisonMetadata: {
          ...value.result.comparisonMetadata!,
          graderVersion: 2,
        } as unknown as TriggeringResult["comparisonMetadata"],
      },
    })],
    ["different-method", (value: ComparableEvalRun) => ({
      ...value,
      result: {
        ...value.result,
        comparisonMetadata: {
          ...value.result.comparisonMetadata!,
          methodVersion: 2,
        } as unknown as TriggeringResult["comparisonMetadata"],
      },
    })],
    ["different-harness", (value: ComparableEvalRun) => ({
      ...value,
      harnessVersionId: HarnessVersionId("other"),
    })],
  ] as const)("refuses %s pairs with a named reason", async (reason, change) => {
    const left = run("left", "v-left", "b-left", [0, 0]);
    const right = change(run("right", "v-right", "b-right", [1, 1]));
    const result = unwrap(
      await compareEvalRuns(repositoryFor([left, right]), userId, left.id, right.id),
    );
    expect(result).toMatchObject({ comparable: false, reason });
  });

  it("does not reveal whether an inaccessible run exists", async () => {
    const left = run("left", "v-left", "b-left", [0, 0]);
    const right = { ...run("right", "v-right", "b-right", [1, 1]), userId: UserId("other") };
    const result = unwrap(
      await compareEvalRuns(repositoryFor([left, right]), userId, left.id, right.id),
    );
    expect(result).toMatchObject({
      comparable: false,
      reason: "run-not-found-or-not-owned",
    });
  });
});

function run(
  id: string,
  versionId: string,
  branchId: string,
  rates: readonly number[],
): ComparableEvalRun {
  const cases = rates.map((rate, index) => ({
    grader: "selection" as const,
    caseId: `case-${index + 1}`,
    prompt: `private prompt ${index + 1}`,
    expected: "fire" as const,
    observed: {
      grader: "selection" as const,
      actual: rate > 0.5 ? "fire" as const : "silent" as const,
      rationale: "private rationale",
    },
    pass: rate > 0.5,
    attempts: 1,
    passedAttempts: rate,
    passRate: rate,
  }));
  return {
    id: EvalRunId(id),
    userId,
    skillId: SkillId("skill-1"),
    skillVersionId: SkillVersionId(versionId),
    branchId: SkillBranchId(branchId),
    harnessVersionId: HarnessVersionId("h1"),
    status: cases.every((item) => item.pass) ? "passed" : "failed",
    result: {
      kind: "triggering-eval",
      cases,
      passed: cases.every((item) => item.pass),
      attempts: 1,
      totalAttempts: cases.length,
      passedAttempts: cases.reduce((sum, item) => sum + item.passedAttempts, 0),
      comparisonMetadata: {
        evaluationSetHash: "set-1",
        grader: "selection",
        graderVersion: 1,
        method: "competitive-selection",
        methodVersion: 1,
      },
      insight: { verdict: "good", summary: "private", findings: [], watch: [] },
    },
    createdAt: new Date(0),
  };
}

function repositoryFor(runs: readonly ComparableEvalRun[]): EvalRunRepository {
  return {
    record: vi.fn(),
    findById: vi.fn(),
    findComparableById: vi.fn(async (id, requestedUser) => {
      const match = runs.find((item) => item.id === id && item.userId === requestedUser);
      return ok(match ?? null);
    }),
    listBySkill: vi.fn(),
    listByUser: vi.fn(),
    listForAnalysis: vi.fn(),
  };
}
