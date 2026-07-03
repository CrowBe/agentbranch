import type { AccountingTag, ModelGateway } from "@/modules/model-gateway";
import type { Evaluator, Insight, Renderer } from "@/modules/skill-analysis";
import { defineEvaluation, insightSchema } from "@/modules/skill-analysis";
import { skillName } from "@/modules/skill";
import {
  generatePromptBattery,
  runTriggeringEval,
  type PromptCase,
} from "@/modules/triggering-eval";
import { err, isErr, ok, type DomainError, type Result } from "@/shared";
import type {
  CrossRuntimeValidationBreakdown,
  CrossRuntimeValidationInput,
  CrossRuntimeValidationResult,
  RuntimeTarget,
  RuntimeTargetResult,
} from "./portability.types";

const INSIGHT_SYSTEM = `You explain cross-runtime validation results for an
agent skill in plain language. Be honest that each target is an approximation,
focus on whether the skill's triggering behaviour stayed stable, and avoid raw
provider or model ids.`;

/**
 * Run the skill's triggering eval against selected runtime targets. This is the
 * validation-first portability engine: no format conversion, just behaviour
 * checked through the model gateway with a per-call target selection.
 */
export async function runCrossRuntimeValidation(
  input: CrossRuntimeValidationInput,
  gateway: ModelGateway,
): Promise<Result<CrossRuntimeValidationResult, DomainError>> {
  const tag = triggeringEvalTag(input);
  const battery = await generateSharedBattery(input, gateway, tag);
  if (isErr(battery)) return battery;

  const targets: RuntimeTargetResult[] = [];

  for (const target of input.targets) {
    const result = await runTarget(input, gateway, target, tag, battery.value);
    if (isErr(result)) return result;
    targets.push(result.value);
  }

  if (targets.every((target) => target.status === "not_configured")) {
    return ok({
      kind: "cross-runtime-validation",
      targets,
      insight: {
        verdict: "needs-attention",
        summary: "No selected runtime target is configured yet.",
        findings: [],
        watch: targets.map((target) => `${target.label} needs a model connection.`),
      },
    });
  }

  const insightTarget = firstConfiguredTarget(input.targets, targets);
  const insight = await gateway.generate({
    system: INSIGHT_SYSTEM,
    prompt: insightPrompt(skillName(input.skill), targets),
    schema: insightSchema,
    tag,
    target: insightTarget?.modelSelection,
  });
  if (isErr(insight)) return insight;

  return ok({ kind: "cross-runtime-validation", targets, insight: insight.value });
}

async function generateSharedBattery(
  input: CrossRuntimeValidationInput,
  gateway: ModelGateway,
  tag: AccountingTag,
): Promise<Result<readonly PromptCase[], DomainError>> {
  for (const target of input.targets) {
    const generated = await generatePromptBattery(input.skill, gateway, tag, target.modelSelection);
    if (!isErr(generated)) return generated;
    if (generated.error.tag === "model_unavailable" || generated.error.tag === "not_configured") {
      continue;
    }
    return err(generated.error);
  }
  return ok([]);
}

function firstConfiguredTarget(
  requested: readonly RuntimeTarget[],
  results: readonly RuntimeTargetResult[],
): RuntimeTarget | undefined {
  const configured = results.find((target) => target.status !== "not_configured");
  return configured
    ? requested.find((target) => target.id === configured.targetId)
    : requested[0];
}

async function runTarget(
  input: CrossRuntimeValidationInput,
  gateway: ModelGateway,
  target: RuntimeTarget,
  tag: AccountingTag,
  battery: readonly PromptCase[],
): Promise<Result<RuntimeTargetResult, DomainError>> {
  const result = await runTriggeringEval(
    input.skill,
    gateway,
    tag,
    { target: target.modelSelection, battery },
  );

  if (isErr(result)) {
    if (result.error.tag === "model_unavailable" || result.error.tag === "not_configured") {
      return ok({
        targetId: target.id,
        label: target.label,
        status: "not_configured",
        message: result.error.message,
      });
    }
    return err(result.error);
  }

  return ok({
    targetId: target.id,
    label: target.label,
    status: result.value.passed ? "passed" : "failed",
    cases: result.value.cases,
  });
}

function triggeringEvalTag(input: CrossRuntimeValidationInput): AccountingTag {
  return { kind: "account", userId: input.skill.userId, capability: "triggering-eval" };
}

function insightPrompt(name: string, targets: readonly RuntimeTargetResult[]): string {
  const lines = targets
    .map((target) => {
      if (target.status === "not_configured") {
        return `- ${target.label}: not configured`;
      }
      const passed = target.cases.filter((c) => c.pass).length;
      return `- ${target.label}: ${target.status}; ${passed}/${target.cases.length} cases passed`;
    })
    .join("\n");
  return `Skill "${name}" cross-runtime validation:\n${lines}`;
}

const evaluator: Evaluator<CrossRuntimeValidationInput, CrossRuntimeValidationResult> = {
  kind: "cross-runtime-validation",
  evaluate: runCrossRuntimeValidation,
};

const insightsRenderer: Renderer<CrossRuntimeValidationResult, Insight> = {
  target: "insights",
  render: (artifact) => artifact.insight,
};

const breakdownRenderer: Renderer<
  CrossRuntimeValidationResult,
  CrossRuntimeValidationBreakdown
> = {
  target: "breakdown",
  render: (artifact) => ({ targets: artifact.targets }),
};

export const portabilityCapability = defineEvaluation({
  name: "cross-runtime validation",
  evaluator,
  renderers: {
    insights: insightsRenderer,
    breakdown: breakdownRenderer,
  },
});
