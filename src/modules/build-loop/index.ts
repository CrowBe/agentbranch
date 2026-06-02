/**
 * build-loop — the core agentic loop (ARCHITECTURE §3, §5.2). **Polished, not
 * thin.** Claude via the Vercel AI SDK writes/edits SKILL.md through the
 * write_skill/edit_skill tools, streaming typed events to the preview over SSE.
 * The model is a port so the loop is provider-swappable and testable.
 */
export type {
  BuildMessage,
  BuildLoopInput,
  BuildLoopEvent,
} from "./build-loop.types";
export type { ModelProvider } from "./model-provider";
export { buildTools, type BuildToolName } from "./tools";
export { runBuildLoop } from "./build-loop";
