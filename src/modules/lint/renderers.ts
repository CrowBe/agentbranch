import type { Renderer } from "@/modules/skill-analysis";
import type { LintBreakdown, LintInsights, LintReport } from "./lint.types";

export const lintInsightsRenderer: Renderer<LintReport, LintInsights> = {
  target: "insights",
  render: (artifact) => {
    const { score, grade } = artifact.summary;
    const hasFindings = artifact.findings.length > 0;
    return {
      score,
      grade,
      summary: hasFindings
        ? `This skill scores ${score}/100. Fix the errors first, then tighten the warnings.`
        : "This skill passes the deterministic structure checks.",
      findings: artifact.findings
        .filter((finding) => finding.severity === "error")
        .map((finding) => finding.message),
      watch: artifact.findings
        .filter((finding) => finding.severity !== "error")
        .map((finding) => finding.message),
    };
  },
};

export const lintBreakdownRenderer: Renderer<LintReport, LintBreakdown> = {
  target: "breakdown",
  render: (artifact) => ({
    summary: artifact.summary,
    findings: artifact.findings,
  }),
};
