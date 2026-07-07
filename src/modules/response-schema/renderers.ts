import type { LintBreakdown, LintInsights } from "@/modules/lint";
import type { Renderer } from "@/modules/skill-analysis";
import type { ResponseSchemaLintReport } from "./response-schema.types";

/** Insights — same friendly shape as skill lint, so quality reads one way. */
export const responseSchemaInsightsRenderer: Renderer<ResponseSchemaLintReport, LintInsights> = {
  target: "insights",
  render: (artifact) => {
    const { score, grade } = artifact.summary;
    const hasFindings = artifact.findings.length > 0;
    return {
      score,
      grade,
      summary: hasFindings
        ? `This response schema scores ${score}/100. Fix the errors first, then tighten the warnings.`
        : "This response schema passes the deterministic structure checks.",
      findings: artifact.findings
        .filter((finding) => finding.severity === "error")
        .map((finding) => finding.message),
      watch: artifact.findings
        .filter((finding) => finding.severity !== "error")
        .map((finding) => finding.message),
    };
  },
};

/** Breakdown — depth on demand: the raw summary + findings. */
export const responseSchemaBreakdownRenderer: Renderer<ResponseSchemaLintReport, LintBreakdown> = {
  target: "breakdown",
  render: (artifact) => ({ summary: artifact.summary, findings: artifact.findings }),
};
