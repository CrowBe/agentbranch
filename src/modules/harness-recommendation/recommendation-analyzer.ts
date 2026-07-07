import type { Analyzer } from "@/modules/skill-analysis";
import type { EvalRunAnalysisRecord } from "@/modules/triggering-eval";
import { ok, type EvalRunId } from "@/shared";
import type {
  CohortStats,
  CorpusCohort,
  HarnessRecommendation,
  HarnessRecommendationReport,
} from "./harness-recommendation.types";

/** Both sides of a correlation split need this many runs before it counts. */
const MIN_SAMPLE = 3;
/** How far apart the fail rates must sit before a rule earns a recommendation. */
const FAIL_RATE_DIFFERENTIAL = 0.25;

/**
 * Tier 1 of the harness improvement loop (ARCHITECTURE §9): zero-token, fully
 * auditable correlation of static skill features — the lint rules a skill
 * version fired — against triggering-eval outcomes. Every recommendation is
 * read-only advice traceable to its evidence runs; a human applies any change
 * as an ordinary diff to `lint-analyzer.ts`.
 */
export const harnessRecommendationAnalyzer: Analyzer<CorpusCohort, HarnessRecommendationReport> = {
  kind: "harness-recommendation",
  async analyze(cohort: CorpusCohort) {
    return ok({
      kind: "harness-recommendation" as const,
      cohort: cohortStats(cohort),
      recommendations: [
        ...ruleCorrelations(cohort.evalRuns),
        ...lintBlindSpot(cohort.evalRuns),
        ...hijackProbeFindings(cohort.evalRuns),
      ],
    });
  },
};

function cohortStats(cohort: CorpusCohort): CohortStats {
  const versions = new Set<string>();
  const harnesses = new Set<string>();
  for (const run of [...cohort.evalRuns, ...cohort.testRuns]) {
    if (run.skillVersionId) versions.add(run.skillVersionId);
    if (run.harnessVersionId) harnesses.add(run.harnessVersionId);
  }
  let falseFires = 0;
  let falseSilents = 0;
  for (const run of cohort.evalRuns) {
    for (const c of run.cases) {
      if (c.pass) continue;
      if (c.expected === "silent") falseFires += 1;
      else falseSilents += 1;
    }
  }
  const failed = cohort.evalRuns.filter((run) => !run.passed).length;
  return {
    evalRuns: cohort.evalRuns.length,
    testRuns: cohort.testRuns.length,
    skillVersions: versions.size,
    harnessVersions: harnesses.size,
    evalFailRate: rate(failed, cohort.evalRuns.length),
    falseFires,
    falseSilents,
  };
}

/**
 * Per fired lint rule: split the cohort into runs whose skill version fired it
 * vs. runs that didn't, and compare triggering-eval failure rates. A rule whose
 * presence tracks failure is under-weighted; a rule that fires just as often on
 * passing skills is noise. Runs without a lint summary (or one persisted before
 * fired rules were recorded) can't join a split and are left out.
 */
function ruleCorrelations(runs: readonly EvalRunAnalysisRecord[]): HarnessRecommendation[] {
  const featured = runs.filter((run) => run.skillLintSummary?.rules !== undefined);
  const rules = new Set(featured.flatMap((run) => run.skillLintSummary?.rules ?? []));

  const recommendations: HarnessRecommendation[] = [];
  for (const rule of [...rules].sort()) {
    const withRule = featured.filter((run) => run.skillLintSummary?.rules?.includes(rule));
    const withoutRule = featured.filter((run) => !run.skillLintSummary?.rules?.includes(rule));
    if (withRule.length < MIN_SAMPLE || withoutRule.length < MIN_SAMPLE) continue;

    const failRateWith = rate(withRule.filter((r) => !r.passed).length, withRule.length);
    const failRateWithout = rate(withoutRule.filter((r) => !r.passed).length, withoutRule.length);
    const evidence = {
      evalRunIds: failingIds(withRule),
      failRateWith,
      failRateWithout,
    };

    if (failRateWith - failRateWithout >= FAIL_RATE_DIFFERENTIAL) {
      recommendations.push({
        target: "lint-rules",
        action: "reweight-rule",
        rule,
        summary:
          `Skills that fire \`${rule}\` fail the triggering eval at ${percent(failRateWith)} ` +
          `vs ${percent(failRateWithout)} without it — consider raising its severity or weight.`,
        evidence,
      });
    } else if (failRateWithout - failRateWith >= FAIL_RATE_DIFFERENTIAL) {
      recommendations.push({
        target: "lint-rules",
        action: "review-rule",
        rule,
        summary:
          `\`${rule}\` fires mostly on skills that pass the triggering eval ` +
          `(${percent(failRateWith)} fail with it vs ${percent(failRateWithout)} without) — ` +
          `review whether it is flagging something that matters.`,
        evidence,
      });
    }
  }
  return recommendations;
}

/**
 * The gap the ruleset cannot see: skill versions that lint clean yet still fail
 * the triggering eval. Enough of them means the failures share a static
 * property no current rule captures — the seed material for a new rule.
 */
function lintBlindSpot(runs: readonly EvalRunAnalysisRecord[]): HarnessRecommendation[] {
  const cleanButFailing = runs.filter(
    (run) => !run.passed && run.skillLintSummary?.rules !== undefined
      && run.skillLintSummary.rules.length === 0,
  );
  if (cleanButFailing.length < MIN_SAMPLE) return [];
  return [
    {
      target: "lint-rules",
      action: "add-rule",
      rule: null,
      summary:
        `${cleanButFailing.length} triggering-eval failures come from skills the current ` +
        `ruleset passes clean — mine these runs' rationales for a static property worth ` +
        `promoting to a rule.`,
      evidence: {
        evalRunIds: cleanButFailing.map((run) => run.id),
        failRateWith: null,
        failRateWithout: null,
      },
    },
  ];
}

/**
 * Adversarial probes that fired: the negative battery's trigger-hijack cases
 * selected the skill anyway. These are the moderation gate's near-misses —
 * evidence for tightening the description policy rules.
 */
function hijackProbeFindings(runs: readonly EvalRunAnalysisRecord[]): HarnessRecommendation[] {
  const hit = runs.filter((run) =>
    run.cases.some((c) => c.risk === "trigger-hijack" && !c.pass),
  );
  if (hit.length === 0) return [];
  return [
    {
      target: "lint-rules",
      action: "review-rule",
      rule: "policy.trigger-hijack",
      summary:
        `${hit.length} run${hit.length === 1 ? "" : "s"} fired on trigger-hijack probes — ` +
        `review the description policy rules against these cases' rationales.`,
      evidence: {
        evalRunIds: hit.map((run) => run.id),
        failRateWith: null,
        failRateWithout: null,
      },
    },
  ];
}

function failingIds(runs: readonly EvalRunAnalysisRecord[]): readonly EvalRunId[] {
  return runs.filter((run) => !run.passed).map((run) => run.id);
}

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100) / 100;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
