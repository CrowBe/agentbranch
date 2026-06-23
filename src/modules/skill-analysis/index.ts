/**
 * skill-analysis — the seam / spine (ARCHITECTURE §3.1).
 *
 * The shared pattern *read input → emit artifact → render for a surface*, built
 * once. Skills are the only concrete input today; the seam is generic so future
 * equipment primitives can reuse it. It carries **two capability shapes**:
 *
 * - **Analysis** (static, text-only) — `defineCapability` + `runCapability`.
 *   Runs offline. Hero (Rendered/Source), Visualise, Export.
 * - **Evaluation** (dynamic, runs input through a model) — `defineEvaluation`
 *   + `runEvaluation`. Handed the **model gateway** (`@/modules/model-gateway`);
 *   guards `model_unavailable`. Test run, Triggering eval — their artifact is an
 *   evaluation result that renders to Insights.
 *
 * New capabilities ask "analysis or evaluation?" first, then "what input,
 * artifact, and renderer?".
 * They never grow a new pipeline.
 */
export type {
  ArtifactKind,
  SourceSpan,
  Artifact,
  AnalysisContext,
  Insight,
  Analyzer,
  Evaluator,
  Renderer,
  AnalysisCapability,
  EvaluationCapability,
  Capability,
} from "./seam.types";
export {
  defineCapability,
  defineEvaluation,
  runCapability,
  runEvaluation,
} from "./seam";
export { insightSchema } from "./insight-schema";
