/**
 * harness-recommendation — the harness improvement loop's report (ARCHITECTURE
 * §9, #118/#122). An **analysis capability** on the seam whose Input is not a
 * `Skill` but a **corpus cohort**: cross-user eval/test-run analysis records
 * read through the admin-gated aggregate reads. Tier 1 is static correlation —
 * zero tokens, runs offline, fully auditable — so it wraps an `Analyzer`, not
 * an `Evaluator`. Output is read-only recommendations, each traceable to its
 * evidence runs; a human applies any change as an ordinary reviewed diff.
 */
import { defineCapability } from "@/modules/skill-analysis";
import type { Renderer } from "@/modules/skill-analysis";
import { harnessRecommendationAnalyzer } from "./recommendation-analyzer";
import type {
  HarnessRecommendationReport,
  HarnessReportSurface,
} from "./harness-recommendation.types";

export type {
  CorpusCohort,
  CohortStats,
  HarnessRecommendation,
  HarnessRecommendationReport,
  HarnessReportSurface,
  RecommendationAction,
  RecommendationEvidence,
} from "./harness-recommendation.types";

/** Report — the admin surface: a headline over the stats + recommendations. */
const reportRenderer: Renderer<HarnessRecommendationReport, HarnessReportSurface> = {
  target: "report",
  render: (report) => ({
    headline:
      report.recommendations.length === 0
        ? `No harness recommendations from ${report.cohort.evalRuns} eval runs — the ruleset and the outcomes agree.`
        : `${report.recommendations.length} harness recommendation${
            report.recommendations.length === 1 ? "" : "s"
          } from ${report.cohort.evalRuns} eval runs across ${report.cohort.skillVersions} skill versions.`,
    cohort: report.cohort,
    recommendations: report.recommendations,
  }),
};

export const harnessRecommendationCapability = defineCapability({
  name: "harness recommendation report",
  analyzer: harnessRecommendationAnalyzer,
  renderers: {
    report: reportRenderer,
  },
});
