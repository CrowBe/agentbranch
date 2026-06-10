import type { Skill } from "@/modules/skill";
import { skillName, skillDescription } from "@/modules/skill";
import type { ModelGateway, AccountingTag } from "@/modules/model-gateway";
import { insightSchema } from "@/modules/skill-analysis";
import { ok, isErr, type Result, type DomainError } from "@/shared";
import { generatePromptBattery } from "./prompt-battery";
import { distractorLibrary } from "./distractor-library";
import type { CaseResult, TriggeringResult } from "./triggering-eval.types";

const INSIGHT_CASE_TEXT_MAX = 240;

/**
 * Run the triggering eval: does the skill fire on the right prompts and stay
 * silent on the wrong ones? (ARCHITECTURE §4) — the cheapest eval, no judge model.
 *
 * Method (the evaluator owns this): build the prompt battery + the competitive
 * field (candidate skill vs. the distractor library), then for each case ask the
 * gateway's `classify` primitive *which* skill the prompt selects. The candidate
 * "fires" iff it wins; selecting a distractor or nothing = "silent". The gateway
 * is pure resource — this composes the eval from one primitive.
 */
export async function runTriggeringEval(
  skill: Skill,
  gateway: ModelGateway,
  tag: AccountingTag,
  options: {
    readonly onCase?: (event: {
      readonly index: number;
      readonly total: number;
      readonly result: CaseResult;
    }) => void | Promise<void>;
  } = {},
): Promise<Result<TriggeringResult, DomainError>> {
  const battery = await generatePromptBattery(skill, gateway, tag);
  if (isErr(battery)) return battery;

  const candidate = candidateLabel(skill);
  const choices = [candidate, ...distractorLibrary.map((d) => `${d.name}: ${d.description}`)];

  const cases: CaseResult[] = [];
  for (const [index, c] of battery.value.entries()) {
    const selected = await gateway.classify({ prompt: c.prompt, choices, tag });
    if (isErr(selected)) return selected;
    const actual: CaseResult["actual"] =
      selected.value.choice === candidate ? "fire" : "silent";
    const result: CaseResult = {
      ...c,
      actual,
      pass: actual === c.expected,
      rationale: selected.value.rationale,
    };
    cases.push(result);
    await options.onCase?.({ index: index + 1, total: battery.value.length, result });
  }
  const passed = cases.every((c) => c.pass);

  // Turn the raw cases into a plain-language Insight (one bounded structured call).
  const insight = await gateway.generate({
    system: INSIGHT_SYSTEM,
    prompt: insightPrompt(skillName(skill), cases, passed),
    schema: insightSchema,
    tag,
  });
  if (isErr(insight)) return insight;

  return ok({ kind: "triggering-eval", cases, passed, insight: insight.value });
}

const INSIGHT_SYSTEM = `You explain a skill's triggering-eval result to its
author in plain language — warm, concrete, no jargon. The author may be
non-technical. Focus on whether the skill fires on the right prompts and stays
quiet on the rest, and call out anything worth adjusting.`;

function insightPrompt(name: string, cases: readonly CaseResult[], passed: boolean): string {
  const lines = cases
    .map(
      (c) =>
        `- "${clampText(c.prompt, INSIGHT_CASE_TEXT_MAX)}" — expected ${c.expected}, got ${c.actual} (${clampText(c.rationale, INSIGHT_CASE_TEXT_MAX)})`,
    )
    .join("\n");
  return `Skill "${name}" triggering eval ${passed ? "passed" : "found issues"}.\n\nCases:\n${lines}`;
}

/** The candidate's choice label — name + description, so the model can tell it
 *  apart from the distractors (which use the same shape). */
function candidateLabel(skill: Skill): string {
  return `${skillName(skill)}: ${skillDescription(skill)}`;
}

function clampText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
