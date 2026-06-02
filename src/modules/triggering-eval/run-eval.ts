import type { Skill } from "@/modules/skill";
import { skillDescription } from "@/modules/skill";
import { ok, type Result, type DomainError } from "@/shared";
import { buildPromptBattery } from "./prompt-battery";
import type { CaseResult, TriggeringResult } from "./triggering-eval.types";

/**
 * Run the triggering eval: does the skill fire on the right prompts and stay
 * silent on the wrong ones? (ARCHITECTURE §4) — the cheapest eval, no judge model.
 *
 * STUB: v1 runs competitive selection of the skill against the distractor
 * library via the model. Here a naive keyword-overlap heuristic stands in so
 * the surface returns a real pass/fail shape offline. The model-backed selector
 * replaces `predictsFire` without changing the result contract.
 */
export async function runTriggeringEval(
  skill: Skill,
): Promise<Result<TriggeringResult, DomainError>> {
  const battery = buildPromptBattery(skill);
  const description = skillDescription(skill).toLowerCase();

  const cases: CaseResult[] = battery.map((c) => {
    const actual = predictsFire(c.prompt, description) ? "fire" : "silent";
    return { ...c, actual, pass: actual === c.expected };
  });

  return ok({ cases, passed: cases.every((c) => c.pass) });
}

function predictsFire(prompt: string, description: string): boolean {
  const words = new Set(description.split(/[^a-z]+/).filter((w) => w.length > 4));
  return prompt
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((w) => words.has(w));
}
