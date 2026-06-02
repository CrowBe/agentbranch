import type { SkillSource } from "@/modules/skill";
import type { Artifact, SourceSpan } from "@/modules/skill-analysis";

/** A markdown section of the body, with its span back into the raw SKILL.md. */
export type DocSection = {
  readonly heading: string;
  readonly level: number;
  readonly body: string;
  readonly span: SourceSpan;
};

/**
 * The hero artifact: computed once, consumed by both renderers. Holds the
 * parsed source, the raw serialized SKILL.md (for Source view + span maths),
 * and the body broken into sections (for Rendered view).
 */
export type HeroArtifact = Artifact<"hero"> & {
  readonly source: SkillSource;
  readonly raw: string;
  readonly sections: readonly DocSection[];
};

/** Rendered view: the friendly, sans-serif structured document (DESIGN §2). */
export type RenderedDoc = {
  readonly title: string;
  readonly description: string;
  readonly sections: readonly DocSection[];
};

/** Source view: the raw monospace SKILL.md (frontmatter + body). */
export type SourceDoc = {
  readonly markdown: string;
};
