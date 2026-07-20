import { defineCapability } from "@/modules/skill-analysis";
import { subagentDefinitionLintAnalyzer } from "./subagent-definition-lint";
import { subagentDefinitionBreakdownRenderer, subagentDefinitionInsightsRenderer } from "./renderers";

export const subagentDefinitionCapability = defineCapability({ name: "subagent definition quality", analyzer: subagentDefinitionLintAnalyzer, renderers: { insights: subagentDefinitionInsightsRenderer, breakdown: subagentDefinitionBreakdownRenderer } });
export { parseSubagentDefinition, serializeSubagentDefinition } from "./subagent-definition-md";
export { createSubagentDefinitionLintReport, subagentDefinitionLintAnalyzer, SUBAGENT_DEFINITION_LINT_RULESET_VERSION } from "./subagent-definition-lint";
export { renderSubagentDefinition, renderSubagentDefinitionSource, subagentDefinitionInsightsRenderer, subagentDefinitionBreakdownRenderer } from "./renderers";
export type { SubagentDefinitionError, SubagentDefinitionLintReport, SubagentDefinitionRendered, SubagentDefinitionSource } from "./subagent-definition.types";
