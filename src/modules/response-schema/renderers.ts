import type { LintBreakdown, LintInsights } from "@/modules/lint";
import type { Renderer } from "@/modules/skill-analysis";
import type { RenderedDoc, SourceDoc } from "@/modules/hero";
import { serializeResponseSchema } from "./response-schema-json";
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

export const responseSchemaRenderedRenderer: Renderer<ResponseSchemaLintReport, RenderedDoc> = {
  target: "rendered",
  render: ({ source }) => {
    const doc = source?.document ?? {};
    const properties = isRecord(doc.properties) ? doc.properties : {};
    const required = new Set(Array.isArray(doc.required) ? doc.required.filter((v): v is string => typeof v === "string") : []);
    const closed = doc.additionalProperties === false ? "Closed — undeclared properties are rejected." : "Open — additional properties are allowed.";
    return { title: typeof doc.title === "string" ? doc.title : "Untitled response schema", description: typeof doc.description === "string" ? doc.description : "No description provided.", sections: Object.entries(properties).map(([name, value]) => {
      const property = isRecord(value) ? value : {};
      const type = typeof property.type === "string" ? property.type : "unspecified";
      const description = typeof property.description === "string" ? property.description : "No description provided.";
      return { heading: `${name}${required.has(name) ? " · required" : ""}`, level: 2, body: `Type: ${type}\n${description}\n${closed}`, span: { start: 0, end: 0 } };
    }) };
  },
};
export const responseSchemaSourceRenderer: Renderer<ResponseSchemaLintReport, SourceDoc> = { target: "source", render: ({ source }) => ({ markdown: source ? serializeResponseSchema(source) : "{}" }) };
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return value !== null && typeof value === "object" && !Array.isArray(value); }
