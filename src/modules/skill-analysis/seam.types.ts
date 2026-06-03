import type { Skill } from "@/modules/skill";
import type { AccountingTag, ModelGateway } from "@/modules/model-gateway";
import type { Result, DomainError } from "@/shared";

/**
 * A character range back into the skill's SKILL.md source. Every artifact node
 * that wants "click here → jump to the line that produced it" carries one.
 * This is what makes the later interactive-visualise point-and-annotate fall
 * out for free (ARCHITECTURE §9).
 */
export type SourceSpan = { readonly start: number; readonly end: number };

/**
 * Closed set of artifact kinds — one per capability on the seam. Adding a new
 * capability means adding its kind here first; free-string kinds are not
 * permitted so the compiler catches mismatched analyzer/renderer pairs.
 */
export type ArtifactKind =
  | "hero"
  | "skill-ir"
  | "export"
  | "test-run"
  | "triggering-eval";

/**
 * The plain-language interpretation of an Evaluation result (CONTEXT.md →
 * Insight). The evaluator produces this via `gateway.generate` *after* its raw
 * run and stores it on the result; the Insights renderer (pure) shapes it for
 * display. This is the seam's interpretation layer — shared by every evaluation
 * kind, so it lives here next to the evaluation contract.
 */
export type Insight = {
  /** Drives the headline tone. */
  readonly verdict: "good" | "needs-attention" | "failing";
  /** 1–2 plain-language sentences the user reads first. */
  readonly summary: string;
  /** What's working well. */
  readonly findings: readonly string[];
  /** Things to look at / act on (e.g. "also fired on 'draft a reply'"). */
  readonly watch: readonly string[];
};

/** The structured thing an analyzer/evaluator emits. `kind` discriminates artifact types. */
export type Artifact<K extends ArtifactKind = ArtifactKind> = { readonly kind: K };

/**
 * Optional resources for analyzers that can improve a static artifact with a
 * bounded model call while retaining deterministic offline behaviour.
 */
export type AnalysisContext = {
  readonly gateway?: ModelGateway;
  readonly tag?: AccountingTag;
};

/**
 * Step one of an ANALYSIS capability: read a skill → emit a structured artifact
 * from its text alone. Pure enough to run offline; no model, no gateway. Async +
 * Result because some analyzers (e.g. visualise's IR) may call a bounded model.
 */
export interface Analyzer<A extends Artifact> {
  readonly kind: A["kind"];
  analyze(skill: Skill, context?: AnalysisContext): Promise<Result<A, DomainError>>;
}

/**
 * Step one of an EVALUATION capability: run the skill through a model and emit
 * a structured result. Owns its *method* — it builds its own conditions
 * (scenario / distractors / battery) — but is handed its *resource*: model
 * access, via the `gateway` (CONTEXT.md → Model gateway). The evaluator composes
 * its method from the gateway's fine primitives (`classify` / `runAgent`); it
 * never touches the raw model, the key, or token accounting. Fails
 * `model_unavailable` when the gateway has no model; that guard lives once in
 * `runEvaluation`, not in each evaluator.
 */
export interface Evaluator<A extends Artifact> {
  readonly kind: A["kind"];
  evaluate(skill: Skill, gateway: ModelGateway): Promise<Result<A, DomainError>>;
}

/**
 * Step two of the seam: render an artifact for a surface. Pure and synchronous
 * — a renderer is a view, never an I/O boundary. Swapping the renderer (Mermaid
 * → React Flow, raw result → Insights) is how a capability gets richer. Shared
 * by both shapes: analysis and evaluation render the same way.
 */
export interface Renderer<A extends Artifact, Surface> {
  readonly target: string;
  render(artifact: A): Surface;
}

/**
 * An ANALYSIS capability: one analyzer feeding one-or-more named renderers.
 * The Rendered hero, Source view, Visualise and Export are analysis capabilities
 * — same shape, different artifact and renderers.
 */
export interface AnalysisCapability<
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
> {
  readonly mode: "analysis";
  readonly name: string;
  readonly analyzer: Analyzer<A>;
  readonly renderers: { readonly [K in keyof Surfaces]: Renderer<A, Surfaces[K]> };
}

/**
 * An EVALUATION capability: one evaluator feeding one-or-more named renderers.
 * Test run and Triggering eval are evaluation capabilities — the artifact is an
 * evaluation result, and its default renderer is Insights (ARCHITECTURE §3.1).
 */
export interface EvaluationCapability<
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
> {
  readonly mode: "evaluation";
  readonly name: string;
  readonly evaluator: Evaluator<A>;
  readonly renderers: { readonly [K in keyof Surfaces]: Renderer<A, Surfaces[K]> };
}

/**
 * A capability on the seam — analysis (static, text-only) or evaluation
 * (dynamic, runs the skill through a model). Discriminated by `mode`. Both share
 * the `artifact → render` tail; they differ only in how the artifact is produced.
 */
export type Capability<
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
> = AnalysisCapability<A, Surfaces> | EvaluationCapability<A, Surfaces>;
