import {
  makeSkill,
  reviseSkill,
  type Skill,
  type SkillSource,
  type SkillVersion,
  type SkillRepository,
} from "@/modules/skill";
import {
  ok,
  err,
  SKILL_VERSION_MAX,
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
  const versions = new Map<string, SkillVersion[]>();

  return {
    async create({ userId, source }) {
      const now = new Date();
      const versionId = SkillVersionId(crypto.randomUUID());
      const skill = makeSkill({
        id: SkillId(crypto.randomUUID()),
        userId,
        source,
        latestRevision: 1,
        latestVersionId: versionId,
        createdAt: now,
        updatedAt: now,
      });
      skills.set(skill.id, skill);
      versions.set(skill.id, [
        { id: versionId, skillId: skill.id, revision: 1, source, createdAt: now },
      ]);
      return ok(skill);
    },

    async checkpoint({ id, userId, source }: { id?: SkillIdT; userId: UserId; source: SkillSource }) {
      const now = new Date();
      if (id) {
        const existing = skills.get(id);
        if (!existing || existing.userId !== userId) return err(domainError("not_found", `No skill ${id}.`));
        const next = { ...existing, source, updatedAt: now };
        skills.set(id, next);
        return ok(next);
      }

      const skill = makeSkill({
        id: SkillId(crypto.randomUUID()),
        userId,
        source,
        latestRevision: 0,
        createdAt: now,
        updatedAt: now,
      });
      skills.set(skill.id, skill);
      versions.set(skill.id, []);
      return ok(skill);
    },

    async save({ id, userId, source }: { id: SkillIdT; userId: UserId; source: SkillSource }) {
      const existing = skills.get(id);
      if (!existing || existing.userId !== userId) return err(domainError("not_found", `No skill ${id}.`));
      const now = new Date();
      const revised = reviseSkill(existing, source, now);
      const versionId = SkillVersionId(crypto.randomUUID());
      const next = { ...revised, latestVersionId: versionId };
      skills.set(id, next);
      versions.set(id, [
        ...(versions.get(id) ?? []),
        { id: versionId, skillId: id, revision: next.latestRevision, source, createdAt: now },
      ]);
      pruneVersions(id);
      return ok(next);
    },

    async restore({ id, userId, revision }: { id: SkillIdT; userId: UserId; revision: number }) {
      const existing = skills.get(id);
      if (!existing || existing.userId !== userId) return err(domainError("not_found", `No skill ${id}.`));

      const version = versions.get(id)?.find((item) => item.revision === revision);
      if (!version) {
        return err(domainError("not_found", `No revision ${revision} for skill ${id}.`));
      }

      const now = new Date();
      const restored = reviseSkill(existing, version.source, now);
      const versionId = SkillVersionId(crypto.randomUUID());
      const next = { ...restored, latestVersionId: versionId };
      skills.set(id, next);
      versions.set(id, [
        ...(versions.get(id) ?? []),
        { id: versionId, skillId: id, revision: next.latestRevision, source: version.source, createdAt: now },
      ]);
      pruneVersions(id);
      return ok(next);
    },

    async findById(id, userId) {
      const skill = skills.get(id);
      return ok(skill?.userId === userId ? skill : null);
    },

    async listByUser(userId: UserId) {
      return ok([...skills.values()].filter((s) => s.userId === userId));
    },

    async listVersions(id, userId) {
      const skill = skills.get(id);
      if (!skill || skill.userId !== userId) return ok([]);
      return ok([...(versions.get(id) ?? [])].sort((a, b) => b.revision - a.revision));
    },

    async delete(id, userId) {
      const skill = skills.get(id);
      if (!skill || skill.userId !== userId) return err(domainError("not_found", `No skill ${id}.`));
      skills.delete(id);
      versions.delete(id);
      return ok(undefined);
    },
  };

  function pruneVersions(id: SkillIdT) {
    const retained = [...(versions.get(id) ?? [])]
      .sort((a, b) => b.revision - a.revision)
      .slice(0, SKILL_VERSION_MAX)
      .sort((a, b) => a.revision - b.revision);
    versions.set(id, retained);
  }
}
