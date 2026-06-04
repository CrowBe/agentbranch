import {
  makeSkill,
  reviseSkill,
  type Skill,
  type SkillSource,
  type SkillRepository,
} from "@/modules/skill";
import { ok, err, SkillId, type UserId, type SkillId as SkillIdT, domainError } from "@/shared";

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
        createdAt: now,
        updatedAt: now,
      });
      skills.set(skill.id, skill);
      return ok(skill);
    },

    async save({ id, source }: { id: SkillIdT; source: SkillSource }) {
      const existing = skills.get(id);
      if (!existing) return err(domainError("not_found", `No skill ${id}.`));
      const next = reviseSkill(existing, source, new Date());
      skills.set(id, next);
      return ok(next);
    },

    async findById(id) {
      return ok(skills.get(id) ?? null);
    },

    async listByUser(userId: UserId) {
      return ok([...skills.values()].filter((s) => s.userId === userId));
    },
  };
}
