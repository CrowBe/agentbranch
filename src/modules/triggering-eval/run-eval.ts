import { createHash } from "node:crypto";
import type { Skill } from "@/modules/skill";
import { skillName, skillDescription } from "@/modules/skill";
import type { ModelGateway, AccountingTag } from "@/modules/model-gateway";
import type { ModelSelection } from "@/modules/model-router";
import { insightSchema, type EvaluationObserver } from "@/modules/skill-analysis";
import { ok, isErr, type Result, type DomainError } from "@/shared";
import { generatePromptBattery } from "./prompt-battery";
import { distractorLibrary } from "./distractor-library";
import type { CaseResult, Distractor, PromptCase, TriggeringResult } from "./triggering-eval.types";

const INSIGHT_CASE_TEXT_MAX = 240;
const MAX_ATTEMPTS = 9;

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
    /** Reports the method as it unfolds (progress + per-case results). */
    readonly observer?: EvaluationObserver;
    readonly target?: ModelSelection;
    readonly battery?: readonly PromptCase[];
    readonly attempts?: number;
  } = {},
): Promise<Result<TriggeringResult, DomainError>> {
  const attemptCount = validateAttempts(options.attempts);
  if (isErr(attemptCount)) return attemptCount;
  let battery: Result<readonly PromptCase[], DomainError>;
  if (options.battery) {
    battery = ok(options.battery);
  } else {
    options.observer?.({ kind: "progress", message: "Building prompt battery." });
    battery = await generatePromptBattery(skill, gateway, tag, options.target);
  }
  if (isErr(battery)) return battery;

  const run = await runBatteryCases(
    { name: skillName(skill), description: skillDescription(skill) },
    battery.value,
    gateway,
    tag,
    options,
  );
  if (isErr(run)) return run;
  const cases = run.value;
  const passed = cases.every((c) => c.pass);

  // Turn the raw cases into a plain-language Insight (one bounded structured call).
  const insight = await gateway.generate({
    system: INSIGHT_SYSTEM,
    prompt: insightPrompt(skillName(skill), cases, passed),
    schema: insightSchema,
    tag,
    target: options.target,
  });
  if (isErr(insight)) return insight;

  return ok({
    kind: "triggering-eval",
    cases,
    passed,
    attempts: attemptCount.value,
    totalAttempts: cases.reduce((sum, c) => sum + c.attempts, 0),
    passedAttempts: cases.reduce((sum, c) => sum + c.passedAttempts, 0),
    insight: insight.value,
  });
}

/**
 * The competitive-selection core the triggering eval (and the regression
 * benchmark) share: for each battery case, ask `classify` which skill the
 * prompt selects from the candidate + the distractor field. The candidate
 * "fires" iff it wins. Distractors default to the library; callers whose
 * candidate *is in* the library (the benchmark's corpus skills) pass a field
 * with the candidate excluded.
 */
export async function runBatteryCases(
  candidate: { readonly name: string; readonly description: string },
  battery: readonly PromptCase[],
  gateway: ModelGateway,
  tag: AccountingTag,
  options: {
    readonly observer?: EvaluationObserver;
    readonly target?: ModelSelection;
    readonly distractors?: readonly Distractor[];
    readonly attempts?: number;
  } = {},
): Promise<Result<readonly CaseResult[], DomainError>> {
  const attempts = validateAttempts(options.attempts);
  if (isErr(attempts)) return attempts;
  const candidateChoice = `${candidate.name}: ${candidate.description}`;
  const field = options.distractors ?? distractorLibrary;
  const choices = [candidateChoice, ...field.map((d) => `${d.name}: ${d.description}`)];

  const cases: CaseResult[] = [];
  for (const [index, c] of battery.entries()) {
    let fireAttempts = 0;
    let passedAttempts = 0;
    let rationale = "";
    for (let attempt = 0; attempt < attempts.value; attempt += 1) {
      const selected = await gateway.classify({
        prompt: c.prompt,
        choices,
        tag,
        target: options.target,
      });
      if (isErr(selected)) return selected;
      const actual = selected.value.choice === candidateChoice ? "fire" : "silent";
      if (actual === "fire") fireAttempts += 1;
      if (actual === c.expected) passedAttempts += 1;
      if (attempt === 0) rationale = selected.value.rationale;
    }
    const actual: CaseResult["actual"] =
      fireAttempts * 2 > attempts.value ? "fire" : "silent";
    const result: CaseResult = {
      ...c,
      caseId: caseId(c),
      actual,
      pass: passedAttempts * 2 > attempts.value,
      attempts: attempts.value,
      passedAttempts,
      passRate: passedAttempts / attempts.value,
      rationale,
    };
    cases.push(result);
    options.observer?.({
      kind: "case",
      index: index + 1,
      total: battery.length,
      prompt: result.prompt,
      expected: result.expected,
      actual: result.actual,
      pass: result.pass,
      attempts: result.attempts,
      passedAttempts: result.passedAttempts,
      passRate: result.passRate,
      rationale: result.rationale,
    });
  }
  return ok(cases);
}

function validateAttempts(value: number | undefined): Result<number, DomainError> {
  const attempts = value ?? 1;
  return Number.isInteger(attempts) &&
    attempts > 0 &&
    attempts <= MAX_ATTEMPTS &&
    attempts % 2 === 1
    ? ok(attempts)
    : {
        ok: false,
        error: {
          tag: "invalid_operation",
          message: `Attempts must be a positive odd integer no greater than ${MAX_ATTEMPTS}.`,
        },
      };
}

/** Versioned canonical identity; display ordering and model output do not affect it. */
function caseId(c: PromptCase): string {
  return createHash("sha256")
    .update(JSON.stringify(["triggering-case", 1, c.expected, c.risk ?? null, c.prompt]))
    .digest("hex");
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

function clampText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
