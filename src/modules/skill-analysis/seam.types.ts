import type { Skill } from "@/modules/skill";
import type { Result, DomainError } from "@/shared";

/**
 * A character range back into the skill's SKILL.md source. Every artifact node
 * that wants "click here → jump to the line that produced it" carries one.
 * This is what makes the later interactive-visualise point-and-annotate fall
 * out for free (ARCHITECTURE §9).
 */
export type SourceSpan = { readonly start: number; readonly end: number };

/** The structured thing an analyzer emits. `kind` discriminates artifact types. */
export type Artifact<Kind extends string = string> = { readonly kind: Kind };

/**
 * Step one of the seam: read a skill → emit a structured artifact.
 * Async + Result because some analyzers (e.g. visualise's IR) call the model.
 */
export interface Analyzer<A extends Artifact> {
  readonly kind: A["kind"];
  analyze(skill: Skill): Promise<Result<A, DomainError>>;
}

/**
 * Step two of the seam: render an artifact for a surface. Pure and synchronous
 * — a renderer is a view, never an I/O boundary. Swapping the renderer (Mermaid
 * → React Flow, pass/fail → scored) is how a capability gets richer.
 */
export interface Renderer<A extends Artifact, Surface> {
  readonly target: string;
  render(artifact: A): Surface;
}

/**
 * A capability on the seam: one analyzer feeding one-or-more named renderers.
 * The Rendered hero, Source view, Visualise, Export and Triggering eval are all
 * Capabilities — same shape, different artifact and renderers.
 */
export interface Capability<
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
> {
  readonly name: string;
  readonly analyzer: Analyzer<A>;
  readonly renderers: { readonly [K in keyof Surfaces]: Renderer<A, Surfaces[K]> };
}
