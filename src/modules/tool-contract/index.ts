/**
 * tool-contract — the second equipment primitive: typed tool input/output plus
 * descriptions, examples, failure modes, and safety notes (ARCHITECTURE §9.2,
 * primitive 2).
 *
 * Analysis-only on its own (lossless source model + pure offline lint); its
 * I/O can reference response-schema artifacts by title, and the relational
 * test run drives its mock-tool registry from a contract — the first
 * cross-primitive evaluation (the Skill × Tool contract composition).
 */
import { defineCapability } from "@/modules/skill-analysis";
import { toolContractLintAnalyzer } from "./tool-contract-lint";
import { toolContractBreakdownRenderer, toolContractInsightsRenderer } from "./renderers";

export const toolContractCapability = defineCapability({
  name: "tool contract quality",
  analyzer: toolContractLintAnalyzer,
  renderers: {
    insights: toolContractInsightsRenderer,
    breakdown: toolContractBreakdownRenderer,
  },
});

export { parseToolContract, serializeToolContract } from "./tool-contract-json";
export {
  createToolContractLintReport,
  toolContractLintAnalyzer,
  TOOL_CONTRACT_LINT_RULESET_VERSION,
  TOOL_NAME_PATTERN,
} from "./tool-contract-lint";
export { toolContractBreakdownRenderer, toolContractInsightsRenderer } from "./renderers";
export type {
  ToolContractError,
  ToolContractExample,
  ToolContractIo,
  ToolContractLintReport,
  ToolContractSource,
} from "./tool-contract.types";
