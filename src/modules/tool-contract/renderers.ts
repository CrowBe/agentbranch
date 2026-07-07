import type { LintBreakdown, LintInsights } from "@/modules/lint";
import type { Renderer } from "@/modules/skill-analysis";
import type { ToolContractLintReport } from "./tool-contract.types";

/** Insights — same friendly shape as skill lint, so quality reads one way. */
export const toolContractInsightsRenderer: Renderer<ToolContractLintReport, LintInsights> = {
  target: "insights",
  render: (artifact) => {
    const { score, grade } = artifact.summary;
    const hasFindings = artifact.findings.length > 0;
    return {
      score,
      grade,
      summary: hasFindings
        ? `This tool contract scores ${score}/100. Fix the errors first, then tighten the warnings.`
        : "This tool contract passes the deterministic structure checks.",
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
export const toolContractBreakdownRenderer: Renderer<ToolContractLintReport, LintBreakdown> = {
  target: "breakdown",
  render: (artifact) => ({ summary: artifact.summary, findings: artifact.findings }),
};
