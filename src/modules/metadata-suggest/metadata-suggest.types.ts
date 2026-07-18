import type { SkillMetadata } from "@/modules/skill";
import type { Artifact } from "@/modules/skill-analysis";

/**
 * The metadata-suggestion artifact: a recommended category + tag set for a
 * skill, alongside what the skill currently carries so a surface can offer
 * accept / merge / edit ("a mix") rather than silent replacement. Suggestions
 * only — nothing is written until the author applies them (via
 * `withSkillMetadata` or a frontmatter edit in the build loop).
 */
export type SkillMetadataSuggestion = Artifact<"skill-metadata"> & {
  readonly name: string;
  readonly description: string;
  /** Always a taxonomy member (or null when nothing fits). */
  readonly category: string | null;
  readonly tags: readonly string[];
  /** One plain-language sentence on why — shown next to the suggestion. */
  readonly rationale: string;
  /** What the skill's frontmatter carries today. */
  readonly current: SkillMetadata;
};

/** The JSON surface the workspace consumes. */
export type SkillMetadataSuggestionView = {
  readonly name: string;
  readonly description: string;
  readonly category: string | null;
  readonly tags: readonly string[];
  readonly rationale: string;
  readonly current: SkillMetadata;
};
