/**
 * build-loop — the core agentic loop (ARCHITECTURE §3, §5.2). **Polished, not
 * thin.** Claude writes/edits SKILL.md through the write_skill/edit_skill tools,
 * streaming typed events to the preview over SSE. The loop reaches the model
 * only through the **model gateway** (`streamAgent`) — the platform's single
 * metered entry — so its turns are gated + accounted like every other model
 * call. It never touches the raw model, the key, or token accounting.
 *
 * The same loop shape authors the first equipment primitive (issue #151):
 * `runResponseSchemaLoop` drives write_response_schema/edit_response_schema
 * under its own frozen cacheable prompt, one prompt + tool pair per primitive.
 */
export type {
  BuildMessage,
  BuildLoopInput,
  BuildLoopEvent,
} from "./build-loop.types";
export { buildTools, type BuildToolName } from "./tools";
export {
  formatLintFeedback,
  formatResponseSchemaLintFeedback,
  formatToolContractLintFeedback,
  formatSubagentDefinitionLintFeedback,
  formatTestRunFeedback,
  formatTriggeringEvalFeedback,
} from "./feedback-formatters";
export { runBuildLoop } from "./build-loop";
export { BUILD_LOOP_SYSTEM_PROMPT } from "./system-prompt";
export {
  runResponseSchemaLoop,
  type ResponseSchemaLoopEvent,
  type ResponseSchemaLoopInput,
} from "./response-schema-loop";
export { responseSchemaTools, type ResponseSchemaToolName } from "./response-schema-tools";
export { RESPONSE_SCHEMA_AUTHORING_PROMPT } from "./response-schema-prompt";
export {
  runToolContractLoop,
  type ToolContractLoopEvent,
  type ToolContractLoopInput,
} from "./tool-contract-loop";
export { toolContractTools, type ToolContractToolName } from "./tool-contract-tools";
export { TOOL_CONTRACT_AUTHORING_PROMPT } from "./tool-contract-prompt";
export { runSubagentDefinitionLoop, type SubagentDefinitionLoopEvent, type SubagentDefinitionLoopInput } from "./subagent-definition-loop";
export { subagentDefinitionTools } from "./subagent-definition-tools";
export { SUBAGENT_DEFINITION_AUTHORING_PROMPT } from "./subagent-definition-prompt";
