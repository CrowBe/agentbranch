/**
 * skill — the product's unit of work (ARCHITECTURE §2).
 *
 * Public surface: the Skill aggregate, lossless SKILL.md parse/serialize, and
 * the persistence port. Everything downstream (analysis, render, export, eval)
 * derives from a Skill; nothing reaches past this barrel into internals.
 */
export type {
  Skill,
  SkillVersion,
  SkillVersionLintSummary,
  SkillBranch,
  SkillBranchStatus,
  RetentionReport,
  SkillSource,
  Frontmatter,
  SkillError,
} from "./skill.types";
export { applySkillEdit, parseSkillMd, serializeSkillMd } from "./skill-md";
export {
  SKILL_CATEGORIES,
  SKILL_TAGS_MAX,
  isSkillCategory,
  isNormalizedSkillTag,
  normalizeSkillTag,
  normalizeSkillTags,
  skillMetadata,
  withSkillMetadata,
} from "./skill-metadata";
export type { SkillCategory, SkillMetadata } from "./skill-metadata";
export {
  makeSkill,
  reviseSkill,
  skillName,
  skillDescription,
} from "./skill";
export { checkSkillCreateCap } from "./skill-cap";
export type { SkillRepository, SkillRetentionRepository } from "./skill.repository";
