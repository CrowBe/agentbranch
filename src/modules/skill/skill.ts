import { type SkillId, type UserId } from "@/shared";
import type { Skill, SkillSource } from "./skill.types";

/**
 * Construct a Skill aggregate from a parsed source. Identity and timestamps
 * are supplied by the caller (the composition root / repository) so this stays
 * pure and deterministic — no clock or id-generator reach-through.
 */
export function makeSkill(params: {
  id: SkillId;
  userId: UserId;
  source: SkillSource;
  latestRevision?: number;
  createdAt: Date;
  updatedAt: Date;
}): Skill {
  return {
    id: params.id,
    userId: params.userId,
    source: params.source,
    latestRevision: params.latestRevision ?? 1,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  };
}

/** Apply an edited source to a skill, bumping `updatedAt`. */
export function reviseSkill(skill: Skill, source: SkillSource, now: Date): Skill {
  return { ...skill, source, latestRevision: skill.latestRevision + 1, updatedAt: now };
}

/** Convenience accessors so callers don't reach through `source.frontmatter`. */
export const skillName = (skill: Skill): string => skill.source.frontmatter.name;
export const skillDescription = (skill: Skill): string =>
  skill.source.frontmatter.description;
