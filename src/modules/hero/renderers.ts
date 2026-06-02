import type { Renderer } from "@/modules/skill-analysis";
import type { HeroArtifact, RenderedDoc, SourceDoc } from "./hero.types";

/**
 * Rendered view — the default. Skill as a friendly structured document: title,
 * plain-language description, sections as readable prose. No visible YAML.
 * (DESIGN §2; layout detail is "not yet designed", DESIGN §6.)
 */
export const renderedRenderer: Renderer<HeroArtifact, RenderedDoc> = {
  target: "rendered",
  render: (artifact) => ({
    title: artifact.source.frontmatter.name,
    description: artifact.source.frontmatter.description,
    sections: artifact.sections,
  }),
};

/**
 * Source view — the toggle. The raw monospace SKILL.md, frontmatter + body.
 * A thin renderer over the already-serialized artifact.
 */
export const sourceRenderer: Renderer<HeroArtifact, SourceDoc> = {
  target: "source",
  render: (artifact) => ({ markdown: artifact.raw }),
};
