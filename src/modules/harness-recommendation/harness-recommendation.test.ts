import { describe, expect, it } from "vitest";
import { runCapability } from "@/modules/skill-analysis";
import type { EvalCaseOutcome, EvalRunAnalysisRecord } from "@/modules/triggering-eval";
import { EvalRunId, HarnessVersionId, SkillId, SkillVersionId, unwrap } from "@/shared";
import { harnessRecommendationCapability } from "./index";
import type { CorpusCohort } from "./index";

function evalRecord(
  id: string,
  passed: boolean,
  rules: readonly string[] | undefined,
  cases: readonly EvalCaseOutcome[] = [
    {
      grader: "selection",
      caseId: "case-1",
      expected: "fire",
      pass: passed,
      observed: { grader: "selection", actual: passed ? "fire" : "silent", rationale: "keyword overlap" },
      attempts: 1,
      passedAttempts: passed ? 1 : 0,
      passRate: passed ? 1 : 0,
    },
  ],
): EvalRunAnalysisRecord {
  return {
    id: EvalRunId(id),
    skillId: SkillId("s1"),
    skillVersionId: SkillVersionId(`v-${id}`),
    harnessVersionId: HarnessVersionId("h1"),
    status: passed ? "passed" : "failed",
    passed,
    attempts: 1,
    totalAttempts: cases.length,
    passedAttempts: cases.filter((item) => item.pass).length,
    cases,
    skillLintSummary:
      rules === undefined
        ? null
        : { score: 80, grade: "B", counts: { error: 0, warn: 1, info: 0 }, rules },
    createdAt: new Date(0),
  };
}

function cohort(evalRuns: readonly EvalRunAnalysisRecord[]): CorpusCohort {
  return { evalRuns, testRuns: [] };
}

describe("harness-recommendation report (Tier 1)", () => {
  it("recommends reweighting a rule whose presence tracks eval failure, traceable to its runs", async () => {
    const report = unwrap(
      await runCapability(
        harnessRecommendationCapability,
        "report",
        cohort([
          evalRecord("f1", false, ["r-bad"]),
          evalRecord("f2", false, ["r-bad"]),
          evalRecord("f3", false, ["r-bad"]),
          evalRecord("p1", true, ["r-ok"]),
          evalRecord("p2", true, ["r-ok"]),
          evalRecord("p3", true, ["r-ok"]),
        ]),
      ),
    );

    const reweight = report.recommendations.find((r) => r.action === "reweight-rule");
    expect(reweight?.rule).toBe("r-bad");
    expect(reweight?.evidence.failRateWith).toBe(1);
    expect(reweight?.evidence.failRateWithout).toBe(0);
    expect(reweight?.evidence.evalRunIds).toEqual(["f1", "f2", "f3", "p1", "p2", "p3"]);
    expect(reweight?.evidence.comparison).toMatchObject({
      rule: "r-bad",
      verdict: "positive-evidence",
      withRunIds: ["f1", "f2", "f3"],
      withoutRunIds: ["p1", "p2", "p3"],
      interval: {
        method: "newcombe-wilson",
        version: 1,
        confidence: 0.95,
        orientation: "with-minus-without",
        with: { numerator: 3, denominator: 3, rate: 1 },
        without: { numerator: 0, denominator: 3, rate: 0 },
        difference: 1,
      },
    });

    // The mirror image: r-ok fires only on passing skills — flagged for review.
    const review = report.recommendations.find(
      (r) => r.action === "review-rule" && r.rule === "r-ok",
    );
    expect(review).toBeDefined();
    expect(review?.evidence.comparison?.verdict).toBe("negative-evidence");
    expect(review?.evidence.comparison?.interval.upper).toBeLessThan(0);

    expect(report.cohort).toMatchObject({
      evalRuns: 6,
      skillVersions: 6,
      harnessVersions: 1,
      evalFailRate: 0.5,
      falseSilents: 3,
      falseFires: 0,
    });
    expect(report.headline).toContain("harness recommendation");
  });

  it("records no evidence when an eligible cohort interval includes zero", async () => {
    const report = unwrap(
      await runCapability(
        harnessRecommendationCapability,
        "report",
        cohort([
          evalRecord("wf1", false, ["r-mixed"]),
          evalRecord("wf2", false, ["r-mixed"]),
          evalRecord("wp1", true, ["r-mixed"]),
          evalRecord("nf1", false, ["r-other"]),
          evalRecord("np1", true, ["r-other"]),
          evalRecord("np2", true, ["r-other"]),
        ]),
      ),
    );

    const comparison = report.comparisons.find(({ rule }) => rule === "r-mixed");
    expect(comparison).toMatchObject({
      verdict: "no-evidence",
      withRunIds: ["wf1", "wf2", "wp1"],
      withoutRunIds: ["nf1", "np1", "np2"],
      interval: {
        with: { numerator: 2, denominator: 3, rate: 2 / 3 },
        without: { numerator: 1, denominator: 3, rate: 1 / 3 },
        difference: 1 / 3,
      },
    });
    expect(comparison!.interval.lower).toBeLessThanOrEqual(0);
    expect(comparison!.interval.upper).toBeGreaterThanOrEqual(0);
    expect(report.recommendations.some(({ rule }) => rule === "r-mixed")).toBe(false);
    expect(report.headline).toContain("include zero");
  });

  it("stays quiet below the sample threshold and without lint features", async () => {
    const report = unwrap(
      await runCapability(
        harnessRecommendationCapability,
        "report",
        cohort([
          evalRecord("f1", false, ["r-bad"]),
          evalRecord("f2", false, ["r-bad"]),
          evalRecord("p1", true, ["r-ok"]),
          evalRecord("p2", true, ["r-ok"]),
          // No lint summary at all — cannot join a correlation split.
          evalRecord("x1", false, undefined),
          evalRecord("x2", false, undefined),
          evalRecord("x3", false, undefined),
        ]),
      ),
    );

    expect(report.recommendations).toEqual([]);
    expect(report.headline).toContain("No harness recommendations");
  });

  it("proposes a new rule when failures cluster on lint-clean skills", async () => {
    const report = unwrap(
      await runCapability(
        harnessRecommendationCapability,
        "report",
        cohort([
          evalRecord("c1", false, []),
          evalRecord("c2", false, []),
          evalRecord("c3", false, []),
        ]),
      ),
    );

    const addRule = report.recommendations.find((r) => r.action === "add-rule");
    expect(addRule?.rule).toBeNull();
    expect(addRule?.evidence.evalRunIds).toEqual(["c1", "c2", "c3"]);
    expect(addRule?.summary).toContain("ruleset passes clean");
  });

  it("surfaces fired trigger-hijack probes as policy-rule evidence", async () => {
    const hijackCase: EvalCaseOutcome = {
      grader: "selection",
      caseId: "hijack-case",
      expected: "silent",
      pass: false,
      observed: { grader: "selection", actual: "fire", rationale: "the broad description won" },
      attempts: 1,
      passedAttempts: 0,
      passRate: 0,
      risk: "trigger-hijack",
    };
    const report = unwrap(
      await runCapability(
        harnessRecommendationCapability,
        "report",
        cohort([evalRecord("hj", false, undefined, [hijackCase])]),
      ),
    );

    const hijack = report.recommendations.find((r) => r.rule === "policy.trigger-hijack");
    expect(hijack?.action).toBe("review-rule");
    expect(hijack?.evidence.evalRunIds).toEqual(["hj"]);
    expect(report.cohort.falseFires).toBe(1);
  });
});
