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
      expected: "fire",
      actual: passed ? "fire" : "silent",
      pass: passed,
      rationale: "keyword overlap",
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
    expect(reweight?.evidence.evalRunIds).toEqual(["f1", "f2", "f3"]);

    // The mirror image: r-ok fires only on passing skills — flagged for review.
    const review = report.recommendations.find(
      (r) => r.action === "review-rule" && r.rule === "r-ok",
    );
    expect(review).toBeDefined();

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
      expected: "silent",
      actual: "fire",
      pass: false,
      rationale: "the broad description won",
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
