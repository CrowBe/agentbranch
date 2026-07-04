import type { ModelGateway } from "@/modules/model-gateway";
import { mapResult, err, domainError, type Result, type DomainError } from "@/shared";
import type {
  Artifact,
  AnalysisContext,
  Analyzer,
  Evaluator,
  EvaluationObserver,
  EvaluationOutcome,
  Renderer,
  AnalysisCapability,
  EvaluationCapability,
  Capability,
} from "./seam.types";

/**
 * Define an ANALYSIS capability — an analyzer composed with its renderers.
 * Keeps the seam's shape honest: a feature is "an analyzer + named renderers".
 * `Input` is inferred from the analyzer's signature; no need to pass it explicitly.
 */
export function defineCapability<
  Input,
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
>(
  capability: Omit<AnalysisCapability<Input, A, Surfaces>, "mode">,
): AnalysisCapability<Input, A, Surfaces> {
  return { mode: "analysis", ...capability };
}

/**
 * Define an EVALUATION capability — an evaluator composed with its renderers
 * (the default surface is Insights). The evaluator owns its method; the model
 * gateway is handed in at run time via `runEvaluation`.
 * `Input` is inferred from the evaluator's signature; no need to pass it explicitly.
 */
export function defineEvaluation<
  Input,
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
>(
  capability: Omit<EvaluationCapability<Input, A, Surfaces>, "mode">,
): EvaluationCapability<Input, A, Surfaces> {
  return { mode: "evaluation", ...capability };
}

/**
 * Run an ANALYSIS capability end-to-end: input → artifact (analyze) → surface
 * (render). The static pipeline, built once. Runs offline — no gateway needed.
 */
export async function runCapability<
  Input,
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
  K extends keyof Surfaces,
>(
  capability: AnalysisCapability<Input, A, Surfaces>,
  surface: K,
  input: Input,
  context?: AnalysisContext,
): Promise<Result<Surfaces[K], DomainError>> {
  const artifact = await capability.analyzer.analyze(input, context);
  return mapResult(artifact, (a) => capability.renderers[surface].render(a));
}

/**
 * Run an EVALUATION capability end-to-end: input → evaluation result (evaluate)
 * → surface (render). The dynamic pipeline. Guards `model_unavailable` *here*,
 * once — so no evaluator re-checks for a model; offline degrades gracefully.
 *
 * The optional `observer` is threaded to the evaluator so it can report its
 * method as it unfolds (progress, per-case results). The outcome carries the
 * raw artifact alongside the rendered surface: recording and eval feedback need
 * the Evaluation result itself, and handing it back here is what keeps callers
 * from reaching past this interface to the evaluator.
 */
export async function runEvaluation<
  Input,
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
  K extends keyof Surfaces,
>(
  capability: EvaluationCapability<Input, A, Surfaces>,
  surface: K,
  input: Input,
  gateway: ModelGateway,
  observer?: EvaluationObserver,
): Promise<Result<EvaluationOutcome<A, Surfaces[K]>, DomainError>> {
  if (!gateway.hasModel) {
    return err(
      domainError(
        "model_unavailable",
        `"${capability.name}" needs a model connection to run. Test runs and triggering evals are unavailable offline.`,
      ),
    );
  }
  const result = await capability.evaluator.evaluate(input, gateway, observer);
  return mapResult(result, (artifact) => ({
    artifact,
    body: capability.renderers[surface].render(artifact),
  }));
}

export type {
  Artifact,
  AnalysisContext,
  Analyzer,
  Evaluator,
  EvaluationObserver,
  EvaluationOutcome,
  Renderer,
  AnalysisCapability,
  EvaluationCapability,
  Capability,
};
