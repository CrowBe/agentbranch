import type { LintBreakdown, LintInsights } from "@/modules/lint";
import type { Renderer } from "@/modules/skill-analysis";
import type { RenderedDoc, SourceDoc } from "@/modules/hero";
import { serializeToolContract } from "./tool-contract-json";
import type { ToolContractLintReport, ToolContractSource } from "./tool-contract.types";

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
const EMPTY_SOURCE: ToolContractSource = { name: "Untitled tool contract", description: "No description provided.", examples: [], failureModes: [], safetyNotes: [], extra: {} };
export const toolContractRenderedRenderer: Renderer<ToolContractLintReport, RenderedDoc> = { target: "rendered", render: ({ source = EMPTY_SOURCE }) => ({ title: source.name, description: source.description, sections: [section("Input", formatIo(source.input)), section("Output", formatIo(source.output)), section("Examples", source.examples.length ? source.examples.map((item) => JSON.stringify(item, null, 2)).join("\n\n") : "No examples provided."), section("Failure modes", source.failureModes.length ? source.failureModes.join("\n") : "No failure modes provided."), section("Safety notes", source.safetyNotes.length ? source.safetyNotes.join("\n") : "No safety notes provided.")] }) };
export const toolContractSourceRenderer: Renderer<ToolContractLintReport, SourceDoc> = { target: "source", render: ({ source }) => ({ markdown: source ? serializeToolContract(source) : "{}" }) };
function section(heading: string, body: string) { return { heading, level: 2, body, span: { start: 0, end: 0 } }; }
function formatIo(io: ToolContractSource["input"]): string { if (!io) return "Not declared."; return io.kind === "schema-ref" ? `Response schema: ${io.ref}` : JSON.stringify(io.schema, null, 2); }
