/**
 * hero — the two views of the skill (ARCHITECTURE §7, DESIGN §2).
 *
 * Rendered (default, friendly document) and Source (raw SKILL.md) are *both
 * renderers on the seam* over one shared artifact — that's why the second view
 * is cheap. Exposed as a single Capability the presentation layer renders.
 */
import { defineCapability } from "@/modules/skill-analysis";
import { heroAnalyzer } from "./hero-analyzer";
import { renderedRenderer, sourceRenderer } from "./renderers";
import type { RenderedDoc, SourceDoc } from "./hero.types";

export const heroCapability = defineCapability({
  name: "hero",
  analyzer: heroAnalyzer,
  renderers: { rendered: renderedRenderer, source: sourceRenderer },
});

export { createHeroArtifact } from "./hero-analyzer";
export { renderedRenderer, sourceRenderer } from "./renderers";
export type { HeroArtifact, RenderedDoc, SourceDoc, DocSection } from "./hero.types";
export type HeroView = "rendered" | "source";
