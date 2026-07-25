import { createHash } from "node:crypto";
import { z } from "zod";
import type { Skill } from "@/modules/skill";
import { skillName, skillDescription } from "@/modules/skill";
import type { ModelGateway, AccountingTag } from "@/modules/model-gateway";
import type { ModelSelection } from "@/modules/model-router";
import { insightSchema, type EvaluationObserver } from "@/modules/skill-analysis";
import { canonicalJson, ok, isErr, type Result, type DomainError } from "@/shared";
import { generatePromptBattery } from "./prompt-battery";
import { distractorLibrary } from "./distractor-library";
import type {
  CaseResult,
  Distractor,
  JsonOutputPromptCase,
  PromptCase,
  SelectionPromptCase,
  TriggeringResult,
} from "./triggering-eval.types";

const INSIGHT_CASE_TEXT_MAX = 240;
const MAX_ATTEMPTS = 9;

/**
 * Run the triggering eval: does the skill fire on the right prompts and stay
 * silent on the wrong ones? (ARCHITECTURE §4) — the cheapest eval, no judge model.
 *
 * Method (the evaluator owns this): build the prompt battery + the competitive
 * field (candidate skill vs. the distractor library), then for each case ask the
 * selection cases use `classify`; JSON-output cases use `generate`, followed by
 * deterministic offline validation against the case's expected schema.
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
  const attemptCount = validateTriggeringAttempts(options.attempts);
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
    ...(cases.every((item) => item.grader === "selection")
      ? {
          comparisonMetadata: {
            evaluationSetHash: evaluationSetHash(cases),
            grader: "selection" as const,
            graderVersion: 1 as const,
            method: "competitive-selection" as const,
            methodVersion: 1 as const,
          },
        }
      : {}),
    insight: insight.value,
  });
}

function evaluationSetHash(cases: readonly CaseResult[]): string {
  return createHash("sha256")
    .update(JSON.stringify(["triggering-evaluation-set", 1, ...cases.map((item) => item.caseId)]))
    .digest("hex");
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
  const attempts = validateTriggeringAttempts(options.attempts);
  if (isErr(attempts)) return attempts;
  const candidateChoice = `${candidate.name}: ${candidate.description}`;
  const field = options.distractors ?? distractorLibrary;
  const choices = [candidateChoice, ...field.map((d) => `${d.name}: ${d.description}`)];

  const cases: CaseResult[] = [];
  for (const [index, c] of battery.entries()) {
    const graded = c.grader === "selection"
      ? await gradeSelectionCase(c, gateway, tag, options.target, candidateChoice, choices, attempts.value)
      : await gradeJsonOutputCase(c, gateway, tag, options.target, attempts.value);
    if (isErr(graded)) return graded;
    const result = graded.value;
    cases.push(result);
    options.observer?.({ kind: "case", index: index + 1, total: battery.length, result });
  }
  return ok(cases);
}

export function validateTriggeringAttempts(
  value: number | undefined,
): Result<number, DomainError> {
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
export function triggeringCaseId(c: PromptCase): string {
  const identity = c.grader === "selection"
    ? ["triggering-case", 1, c.expected, c.risk ?? null, c.prompt]
    : ["triggering-case", 2, "json-output", c.graderVersion, c.prompt, canonicalJson(c.expectedSchema)];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

async function gradeSelectionCase(
  c: SelectionPromptCase,
  gateway: ModelGateway,
  tag: AccountingTag,
  target: ModelSelection | undefined,
  candidateChoice: string,
  choices: readonly string[],
  attempts: number,
): Promise<Result<CaseResult, DomainError>> {
  let fireAttempts = 0;
  let passedAttempts = 0;
  let rationale = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const selected = await gateway.classify({ prompt: c.prompt, choices, tag, target });
    if (isErr(selected)) return selected;
    const actual = selected.value.choice === candidateChoice ? "fire" : "silent";
    if (actual === "fire") fireAttempts += 1;
    if (actual === c.expected) passedAttempts += 1;
    if (attempt === 0) rationale = selected.value.rationale;
  }
  const actual = fireAttempts * 2 > attempts ? "fire" : "silent";
  return ok({
    ...c,
    caseId: triggeringCaseId(c),
    observed: {
      grader: "selection",
      actual,
      rationale,
    },
    pass: passedAttempts * 2 > attempts,
    attempts,
    passedAttempts,
    passRate: passedAttempts / attempts,
  });
}

async function gradeJsonOutputCase(
  c: JsonOutputPromptCase,
  gateway: ModelGateway,
  tag: AccountingTag,
  target: ModelSelection | undefined,
  attempts: number,
): Promise<Result<CaseResult, DomainError>> {
  let validator: z.ZodType;
  try {
    validator = z.fromJSONSchema(c.expectedSchema);
  } catch (cause) {
    return {
      ok: false,
      error: {
        tag: "invalid_operation",
        message: "The JSON-output grader schema is invalid or unsupported.",
        cause,
      },
    };
  }
  const outcomes: { output: unknown; issues: readonly string[]; pass: boolean }[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const generated = await gateway.generate({
      system: "Produce the requested JSON value. Output JSON only.",
      prompt: c.prompt,
      schema: z.json(),
      tag,
      target,
    });
    if (isErr(generated)) return generated;
    const parsed = validator.safeParse(generated.value);
    outcomes.push({
      output: generated.value,
      pass: parsed.success,
      issues: parsed.success
        ? []
        : parsed.error.issues.map((issue) =>
            `${issue.path.length === 0 ? "$" : `$.${issue.path.join(".")}`}: ${issue.message}`
          ),
    });
  }
  const passedAttempts = outcomes.filter((outcome) => outcome.pass).length;
  const pass = passedAttempts * 2 > attempts;
  const representative = outcomes.find((outcome) => outcome.pass === pass) ?? outcomes[0]!;
  return ok({
    ...c,
    caseId: triggeringCaseId(c),
    observed: {
      grader: "json-output",
      output: representative.output,
      validationIssues: representative.issues,
    },
    pass,
    attempts,
    passedAttempts,
    passRate: passedAttempts / attempts,
  });
}

const INSIGHT_SYSTEM = `You explain a skill's triggering-eval result to its
author in plain language — warm, concrete, no jargon. The author may be
non-technical. Focus on whether the skill fires on the right prompts and stays
quiet on the rest, and call out anything worth adjusting.`;

function insightPrompt(name: string, cases: readonly CaseResult[], passed: boolean): string {
  const lines = cases
    .map((c) => describeCaseForInsight(c))
    .join("\n");
  return `Skill "${name}" triggering eval ${passed ? "passed" : "found issues"}.\n\nCases:\n${lines}`;
}

function describeCaseForInsight(c: CaseResult): string {
  if (c.grader === "selection") {
    return `- "${clampText(c.prompt, INSIGHT_CASE_TEXT_MAX)}" — expected ${c.expected}, got ${c.observed.actual} (${clampText(c.observed.rationale, INSIGHT_CASE_TEXT_MAX)})`;
  }
  const detail = c.pass
    ? "output matched the expected JSON schema"
    : c.observed.validationIssues.join("; ");
  return `- "${clampText(c.prompt, INSIGHT_CASE_TEXT_MAX)}" — ${clampText(detail, INSIGHT_CASE_TEXT_MAX)}`;
}

function clampText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
