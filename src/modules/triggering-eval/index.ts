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
import type { Evaluator } from "@/modules/skill-analysis";
import { runTriggeringEval } from "./run-eval";
import type { TriggeringResult } from "./triggering-eval.types";

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

const triggeringEvaluator: Evaluator<TriggeringResult> = {
  kind: "triggering-eval",
  evaluate: (skill, gateway) =>
    // Triggering an eval is user-attributable work → `account` tag.
    runTriggeringEval(skill, gateway, { kind: "account", userId: skill.userId }),
};

export const triggeringEvalCapability = defineEvaluation({
  name: "triggering eval",
  evaluator: triggeringEvaluator,
  renderers: {
    /** Interim raw-artifact surface; Insights renderer lands in step (d). */
    result: { target: "result", render: (a: TriggeringResult) => a },
  },
});
