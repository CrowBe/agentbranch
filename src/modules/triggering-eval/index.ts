/**
 * triggering-eval — does the skill fire on the right prompts, stay silent on
 * the wrong ones? (ARCHITECTURE §4, §5.5). The #1 failure mode (bad
 * description/triggers), tested competitively against a distractor library.
 *
 * An **evaluation capability** on the seam: the evaluator owns its method
 * (builds the battery + distractor field, composes `gateway.classify`); the
 * model gateway is handed in. Its artifact is the `TriggeringResult` — rendered
 * to Insights (the friendly surface lands in build-out step d; the `result`
 * surface returns the raw artifact meanwhile).
 */
import { defineEvaluation } from "@/modules/skill-analysis";
import type { Evaluator, Renderer, Insight } from "@/modules/skill-analysis";
import type { Skill } from "@/modules/skill";
import { runTriggeringEval } from "./run-eval";
import type { CaseResult, TriggeringResult } from "./triggering-eval.types";

/** The detailed-breakdown surface: the raw per-prompt cases + the pass flag. */
export type TriggeringBreakdown = {
  readonly passed: boolean;
  readonly cases: readonly CaseResult[];
};

export type {
  Distractor,
  PromptCase,
  CaseResult,
  TriggeringResult,
  EvalRun,
  EvalStatus,
} from "./triggering-eval.types";
export { distractorLibrary } from "./distractor-library";
export { generatePromptBattery, PROMPT_BATTERY_GENERATOR_VERSION } from "./prompt-battery";
export { runTriggeringEval } from "./run-eval";
export type { EvalRunRepository } from "./eval.repository";

const triggeringEvaluator: Evaluator<Skill, TriggeringResult> = {
  kind: "triggering-eval",
  evaluate: (skill, gateway) =>
    // Triggering an eval is user-attributable work → `account` tag, declaring the
    // `triggering-eval` capability so usage gates it against the right cap (free
    // disallows it entirely, ARCHITECTURE §8).
    runTriggeringEval(skill, gateway, {
      kind: "account",
      userId: skill.userId,
      capability: "triggering-eval",
    }),
};

/** Insights — default, friendly: the model-written interpretation, shaped pure. */
const insightsRenderer: Renderer<TriggeringResult, Insight> = {
  target: "insights",
  render: (a) => a.insight,
};

/** Breakdown — depth on demand: the raw per-prompt cases. */
const breakdownRenderer: Renderer<TriggeringResult, TriggeringBreakdown> = {
  target: "breakdown",
  render: (a) => ({ passed: a.passed, cases: a.cases }),
};

export const triggeringEvalCapability = defineEvaluation({
  name: "triggering eval",
  evaluator: triggeringEvaluator,
  renderers: {
    insights: insightsRenderer,
    breakdown: breakdownRenderer,
  },
});
