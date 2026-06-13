import {
  makeSkill,
  reviseSkill,
  type Skill,
  type SkillSource,
  type SkillRepository,
} from "@/modules/skill";
import {
  ok,
  err,
  SkillId,
  SkillVersionId,
  type UserId,
  type SkillId as SkillIdT,
  domainError,
} from "@/shared";

/**
 * In-memory SkillRepository — the default adapter so the app runs with no DB
 * (ARCHITECTURE: persistence falls back to memory absent DATABASE_URL). Also
 * the adapter domain tests run against.
 */
export function createMemorySkillRepository(): SkillRepository {
  const skills = new Map<string, Skill>();

  return {
    async create({ userId, source }) {
      const now = new Date();
      const skill = makeSkill({
        id: SkillId(crypto.randomUUID()),
        userId,
        source,
        latestRevision: 1,
        latestVersionId: SkillVersionId(crypto.randomUUID()),
        createdAt: now,
        updatedAt: now,
      });
      skills.set(skill.id, skill);
      return ok(skill);
    },

    async save({ id, userId, source }: { id: SkillIdT; userId: UserId; source: SkillSource }) {
      const existing = skills.get(id);
      if (!existing || existing.userId !== userId) return err(domainError("not_found", `No skill ${id}.`));
      const revised = reviseSkill(existing, source, new Date());
      const next = { ...revised, latestVersionId: SkillVersionId(crypto.randomUUID()) };
      skills.set(id, next);
      return ok(next);
    },

    async findById(id, userId) {
      const skill = skills.get(id);
      return ok(skill?.userId === userId ? skill : null);
    },

    async listByUser(userId: UserId) {
      return ok([...skills.values()].filter((s) => s.userId === userId));
    },

    async delete(id, userId) {
      const skill = skills.get(id);
      if (!skill || skill.userId !== userId) return err(domainError("not_found", `No skill ${id}.`));
      skills.delete(id);
      return ok(undefined);
    },
  };
}
