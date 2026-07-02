/**
 * build-loop — the core agentic loop (ARCHITECTURE §3, §5.2). **Polished, not
 * thin.** Claude writes/edits SKILL.md through the write_skill/edit_skill tools,
 * streaming typed events to the preview over SSE. The loop reaches the model
 * only through the **model gateway** (`streamAgent`) — the platform's single
 * metered entry — so its turns are gated + accounted like every other model
 * call. It never touches the raw model, the key, or token accounting.
 */
export type {
  BuildMessage,
  BuildLoopInput,
  BuildLoopEvent,
} from "./build-loop.types";
export { buildTools, type BuildToolName } from "./tools";
export {
  formatLintFeedback,
  formatTestRunFeedback,
  formatTriggeringEvalFeedback,
} from "./feedback-formatters";
export { runBuildLoop } from "./build-loop";
export { BUILD_LOOP_SYSTEM_PROMPT } from "./system-prompt";
