/**
 * triggering-eval — does the skill fire on the right prompts, stay silent on
 * the wrong ones? (ARCHITECTURE §4, §5.5). The #1 failure mode (bad
 * description/triggers), tested competitively against a distractor library.
 */
export type {
  Distractor,
  PromptCase,
  CaseResult,
  TriggeringResult,
  EvalRun,
  EvalStatus,
} from "./triggering-eval.types";
export { distractorLibrary } from "./distractor-library";
export { buildPromptBattery } from "./prompt-battery";
export { runTriggeringEval } from "./run-eval";
export type { EvalRunRepository } from "./eval.repository";
