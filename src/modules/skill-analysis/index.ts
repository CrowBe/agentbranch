/**
 * skill-analysis — the seam / spine (ARCHITECTURE §3.1).
 *
 * The shared pattern *read skill → emit artifact → render for a surface*, built
 * once. The seam carries **two capability shapes**:
 *
 * - **Analysis** (static, text-only) — `defineCapability` + `runCapability`.
 *   Runs offline. Hero (Rendered/Source), Visualise, Export.
 * - **Evaluation** (dynamic, runs the skill through a model) — `defineEvaluation`
 *   + `runEvaluation`. Needs the evaluation harness; guards `model_unavailable`.
 *   Test run, Triggering eval — their artifact is an evaluation result that
 *   renders to Insights.
 *
 * New capabilities ask "analysis or evaluation?" first, then "what renderer?".
 * They never grow a new pipeline.
 */
export type {
  ArtifactKind,
  SourceSpan,
  Artifact,
  Analyzer,
  Evaluator,
  Renderer,
  EvaluationHarness,
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
