/**
 * lint — deterministic SKILL.md quality checks.
 *
 * Tier 1 is pure analysis: no model, no gateway, one artifact with friendly
 * Insights and detailed Breakdown renderers.
 */
import { defineCapability } from "@/modules/skill-analysis";
import { lintAnalyzer } from "./lint-analyzer";
import { lintBreakdownRenderer, lintInsightsRenderer } from "./renderers";
import type { LintBreakdown, LintInsights, LintReport } from "./lint.types";

export const lintCapability = defineCapability<
  LintReport,
  { insights: LintInsights; breakdown: LintBreakdown }
>({
  name: "lint",
  analyzer: lintAnalyzer,
  renderers: { insights: lintInsightsRenderer, breakdown: lintBreakdownRenderer },
});

export { createLintReport, createLintSummary, lintAnalyzer } from "./lint-analyzer";
export { lintBreakdownRenderer, lintInsightsRenderer } from "./renderers";
export type {
  LintBreakdown,
  LintFinding,
  LintInsights,
  LintReport,
  LintSeverity,
  LintSummary,
} from "./lint.types";
