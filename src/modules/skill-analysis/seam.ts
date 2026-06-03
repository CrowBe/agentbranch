import type { Skill } from "@/modules/skill";
import type { ModelGateway } from "@/modules/model-gateway";
import { mapResult, err, domainError, type Result, type DomainError } from "@/shared";
import type {
  Artifact,
  Analyzer,
  Evaluator,
  Renderer,
  AnalysisCapability,
  EvaluationCapability,
  Capability,
} from "./seam.types";

/**
 * Define an ANALYSIS capability — an analyzer composed with its renderers.
 * Keeps the seam's shape honest: a feature is "an analyzer + named renderers".
 */
export function defineCapability<
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
>(
  capability: Omit<AnalysisCapability<A, Surfaces>, "mode">,
): AnalysisCapability<A, Surfaces> {
  return { mode: "analysis", ...capability };
}

/**
 * Define an EVALUATION capability — an evaluator composed with its renderers
 * (the default surface is Insights). The evaluator owns its method; the model
 * gateway is handed in at run time via `runEvaluation`.
 */
export function defineEvaluation<
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
>(
  capability: Omit<EvaluationCapability<A, Surfaces>, "mode">,
): EvaluationCapability<A, Surfaces> {
  return { mode: "evaluation", ...capability };
}

/**
 * Run an ANALYSIS capability end-to-end: skill → artifact (analyze) → surface
 * (render). The static pipeline, built once. Runs offline — no gateway needed.
 */
export async function runCapability<
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
  K extends keyof Surfaces,
>(
  capability: AnalysisCapability<A, Surfaces>,
  surface: K,
  skill: Skill,
): Promise<Result<Surfaces[K], DomainError>> {
  const artifact = await capability.analyzer.analyze(skill);
  return mapResult(artifact, (a) => capability.renderers[surface].render(a));
}

/**
 * Run an EVALUATION capability end-to-end: skill → evaluation result (evaluate)
 * → surface (render). The dynamic pipeline. Guards `model_unavailable` *here*,
 * once — so no evaluator re-checks for a model; offline degrades gracefully.
 */
export async function runEvaluation<
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
  K extends keyof Surfaces,
>(
  capability: EvaluationCapability<A, Surfaces>,
  surface: K,
  skill: Skill,
  gateway: ModelGateway,
): Promise<Result<Surfaces[K], DomainError>> {
  if (!gateway.hasModel) {
    return err(
      domainError(
        "model_unavailable",
        `"${capability.name}" needs a model connection to run. Test runs and triggering evals are unavailable offline.`,
      ),
    );
  }
  const result = await capability.evaluator.evaluate(skill, gateway);
  return mapResult(result, (a) => capability.renderers[surface].render(a));
}

export type {
  Artifact,
  Analyzer,
  Evaluator,
  Renderer,
  AnalysisCapability,
  EvaluationCapability,
  Capability,
};
