import type { SkillId, SkillVersionId, UserId } from "@/shared";

/**
 * The YAML frontmatter of a SKILL.md. `name` and `description` are the two
 * fields Claude uses to decide whether to reach for a skill, so they are
 * first-class; anything else the author writes is preserved verbatim.
 */
export type Frontmatter = {
  readonly name: string;
  readonly description: string;
  readonly extra: Readonly<Record<string, unknown>>;
};

/**
 * The raw, source-of-truth representation of a skill: frontmatter + the
 * markdown body. This is what `parseSkillMd` produces and `serializeSkillMd`
 * round-trips. It carries no identity or persistence concerns.
 */
export type SkillSource = {
  readonly frontmatter: Frontmatter;
  readonly body: string;
};

/**
 * A persisted skill — `SkillSource` plus identity and timestamps. This is the
 * aggregate the rest of the app passes around; everything else (IR, render,
 * export, eval) is derived from it via the skill-analysis seam.
 */
export type Skill = {
  readonly id: SkillId;
  readonly userId: UserId;
  readonly source: SkillSource;
  readonly latestRevision: number;
  readonly latestVersionId?: SkillVersionId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type SkillVersion = {
  readonly id: SkillVersionId;
  readonly skillId: SkillId;
  readonly revision: number;
  readonly source: SkillSource;
  readonly createdAt: Date;
};

/** Failure modes when reading or validating a SKILL.md. */
export type SkillError =
  | { readonly tag: "invalid_frontmatter"; readonly message: string }
  | { readonly tag: "missing_name"; readonly message: string }
  | { readonly tag: "missing_description"; readonly message: string }
  | { readonly tag: "edit_no_match"; readonly message: string }
  | { readonly tag: "edit_invalid_skill"; readonly message: string };
