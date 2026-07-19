import type { LintBreakdown, LintInsights } from "@/modules/lint";
import type { Renderer } from "@/modules/skill-analysis";
import { serializeSubagentDefinition } from "./subagent-definition-md";
import type { SubagentDefinitionLintReport, SubagentDefinitionRendered, SubagentDefinitionSource } from "./subagent-definition.types";

export const subagentDefinitionInsightsRenderer: Renderer<SubagentDefinitionLintReport, LintInsights> = {
  target: "insights",
  render: ({ summary, findings }) => ({ score: summary.score, grade: summary.grade, summary: findings.length ? `This subagent definition scores ${summary.score}/100. Tighten its delegation description, role, tools, and boundaries.` : "This subagent definition passes the deterministic quality checks.", findings: findings.filter((f) => f.severity === "error").map((f) => f.message), watch: findings.filter((f) => f.severity !== "error").map((f) => f.message) }),
};
export const subagentDefinitionBreakdownRenderer: Renderer<SubagentDefinitionLintReport, LintBreakdown> = { target: "breakdown", render: ({ summary, findings }) => ({ summary, findings }) };

export function renderSubagentDefinition(source: SubagentDefinitionSource): SubagentDefinitionRendered {
  return { name: source.frontmatter.name, description: source.frontmatter.description, tools: source.frontmatter.tools ?? [], ...(source.frontmatter.model === undefined ? {} : { model: source.frontmatter.model }), instructions: source.body };
}
export function renderSubagentDefinitionSource(source: SubagentDefinitionSource): string { return serializeSubagentDefinition(source); }
