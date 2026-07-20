import { summarizeLintFindings, type LintFinding } from "@/modules/lint";
import type { Analyzer } from "@/modules/skill-analysis";
import { ok } from "@/shared";
import type { SubagentDefinitionLintReport, SubagentDefinitionSource } from "./subagent-definition.types";

export const SUBAGENT_DEFINITION_LINT_RULESET_VERSION = {
  descriptionMin: 40,
  bodyMin: 120,
} as const;

export const subagentDefinitionLintAnalyzer: Analyzer<SubagentDefinitionSource, SubagentDefinitionLintReport> = {
  kind: "subagent-definition-lint",
  async analyze(source) { return ok(createSubagentDefinitionLintReport(source)); },
};

export function createSubagentDefinitionLintReport(source: SubagentDefinitionSource): SubagentDefinitionLintReport {
  const findings: LintFinding[] = [];
  const { name, description, tools, model } = source.frontmatter;
  const body = source.body.trim();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) findings.push(finding("subagent.name.format", "warn", "Use a kebab-case name so the definition is portable and easy to reference.", 10));
  if (description.trim().length < SUBAGENT_DEFINITION_LINT_RULESET_VERSION.descriptionMin) findings.push(finding("subagent.description.thin", "warn", "Explain what this specialist does and when it should be delegated to.", 15));
  if (body.length === 0) findings.push(finding("subagent.instructions.empty", "error", "Add a system-prompt body that tells the specialist how to do its job.", 30));
  else if (body.length < SUBAGENT_DEFINITION_LINT_RULESET_VERSION.bodyMin || body.split("\n").filter(Boolean).length === 1) findings.push(finding("subagent.instructions.thin", "warn", "Expand the instructions beyond one short line with workflow and boundaries.", 20));
  if (body.length > 0 && !/\b(?:you are|your role|act as|speciali[sz]e|responsib)/i.test(body)) findings.push(finding("subagent.role.missing", "warn", "State the specialist's role explicitly in the instructions.", 15));
  if (tools !== undefined && tools.length === 0) findings.push(finding("subagent.tools.empty", "warn", "Remove the empty tools list or name the tools the specialist may use.", 10));
  if (tools?.some((tool) => tool === "*" || tool.toLowerCase() === "all") && !/\b(?:never|only|must not|approval|boundary|limit)/i.test(body)) findings.push(finding("subagent.tools.over-broad", "error", "An unrestricted tools list needs an explicit safety boundary in the instructions.", 25));
  if (model !== undefined && !/^[a-z0-9][a-z0-9._:/-]*$/i.test(model)) findings.push(finding("subagent.model.unknown-shape", "info", "The model value has an unusual shape; use a provider-supported model identifier.", 5));

  return { kind: "subagent-definition-lint", summary: summarizeLintFindings(findings), findings };
}

function finding(rule: string, severity: LintFinding["severity"], message: string, scorePenalty: number): LintFinding {
  return { rule, severity, message, scorePenalty };
}
