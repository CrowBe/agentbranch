import type { Skill } from "@/modules/skill";
import { mapResult, type Result, type DomainError } from "@/shared";
import type { Artifact, Analyzer, Renderer, Capability } from "./seam.types";

/**
 * Define a capability — the single place features compose an analyzer with its
 * renderers. Keeps the seam's shape honest: a feature is "an analyzer + named
 * renderers", nothing more.
 */
export function defineCapability<
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
>(capability: Capability<A, Surfaces>): Capability<A, Surfaces> {
  return capability;
}

/**
 * Run the seam end-to-end: skill → artifact (analyze) → surface (render).
 * This is *the pipeline*, built once. Features never re-implement it — they
 * pick a capability and a surface and call here.
 */
export async function runCapability<
  A extends Artifact,
  Surfaces extends Record<string, unknown>,
  K extends keyof Surfaces,
>(
  capability: Capability<A, Surfaces>,
  surface: K,
  skill: Skill,
): Promise<Result<Surfaces[K], DomainError>> {
  const artifact = await capability.analyzer.analyze(skill);
  return mapResult(artifact, (a) => capability.renderers[surface].render(a));
}

export type { Artifact, Analyzer, Renderer, Capability };
