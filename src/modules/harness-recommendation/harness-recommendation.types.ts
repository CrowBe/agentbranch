import type { Artifact } from "@/modules/skill-analysis";
import type { EvalRunAnalysisRecord } from "@/modules/triggering-eval";
import type { TestRunAnalysisRecord } from "@/modules/test-run";
import type { EvalRunId } from "@/shared";

/**
 * The report's Input — the first capability on the seam whose input is not a
 * `Skill` (ARCHITECTURE §9): an aggregate cohort of evaluation records, read
 * through the admin-gated analysis reads. Outcomes and features only; no user
 * identity, prompt text, or skill content ever reaches this module.
 */
export type CorpusCohort = {
  readonly evalRuns: readonly EvalRunAnalysisRecord[];
  readonly testRuns: readonly TestRunAnalysisRecord[];
};

/** What a Tier-1 recommendation proposes doing to the lint ruleset. */
export type RecommendationAction = "add-rule" | "reweight-rule" | "review-rule";

/**
 * The evidence a recommendation is traceable to (#122's bar): the run records
 * behind it, plus the correlation split when the recommendation is rule-shaped.
 */
export type RecommendationEvidence = {
  readonly evalRunIds: readonly EvalRunId[];
  /** Triggering-eval failure rate among runs whose skill fired the rule. */
  readonly failRateWith: number | null;
  /** …and among runs whose skill did not. */
  readonly failRateWithout: number | null;
};

export type HarnessRecommendation = {
  /** Tier 1 targets only the lint ruleset (`lint-analyzer.ts`). */
  readonly target: "lint-rules";
  readonly action: RecommendationAction;
  /** The existing rule this speaks to; null for an add-rule proposal. */
  readonly rule: string | null;
  readonly summary: string;
  readonly evidence: RecommendationEvidence;
};

export type CohortStats = {
  readonly evalRuns: number;
  readonly testRuns: number;
  readonly skillVersions: number;
  readonly harnessVersions: number;
  readonly evalFailRate: number;
  /** Cases expected silent that fired. */
  readonly falseFires: number;
  /** Cases expected to fire that stayed silent. */
  readonly falseSilents: number;
};

/** The harness-recommendation report — the artifact this capability emits. */
export type HarnessRecommendationReport = Artifact<"harness-recommendation"> & {
  readonly cohort: CohortStats;
  readonly recommendations: readonly HarnessRecommendation[];
};

/** The admin report surface — the rendered view of the report. */
export type HarnessReportSurface = {
  readonly headline: string;
  readonly cohort: CohortStats;
  readonly recommendations: readonly HarnessRecommendation[];
};
