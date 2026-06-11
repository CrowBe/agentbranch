import type { PrismaClient } from "@prisma/client";
import {
  makeSkill,
  type Skill,
  type SkillSource,
  type SkillRepository,
} from "@/modules/skill";
import {
  ok,
  err,
  SkillId,
  SkillVersionId,
  UserId,
  domainError,
  type SkillId as SkillIdT,
} from "@/shared";

type SkillRow = {
  id: string;
  userId: string;
  name: string;
  description: string;
  body: string;
  frontmatterJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/** Rehydrate the Skill aggregate from a persisted row. */
function toSkill(row: SkillRow, latestRevision: number, latestVersionId?: string): Skill {
  return makeSkill({
    id: SkillId(row.id),
    userId: UserId(row.userId),
    source: {
      frontmatter: {
        name: row.name,
        description: row.description,
        extra: (row.frontmatterJson as Record<string, unknown>) ?? {},
      },
      body: row.body,
    },
    latestRevision,
    latestVersionId: latestVersionId ? SkillVersionId(latestVersionId) : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

const columns = (source: SkillSource) => ({
  name: source.frontmatter.name,
  description: source.frontmatter.description,
  body: source.body,
  frontmatterJson: source.frontmatter.extra as object,
});

/**
 * Prisma SkillRepository (real). Each create/save also appends a SkillVersion
 * so an export is a pure function of a version (ARCHITECTURE §6).
 */
export function createPrismaSkillRepository(prisma: PrismaClient): SkillRepository {
  return {
    async create({ userId, source }) {
      const skill = await prisma.skill.create({
        data: {
          userId,
          ...columns(source),
          versions: { create: { revision: 1, ...columns(source) } },
        },
        include: { versions: { orderBy: { revision: "desc" }, take: 1, select: { id: true } } },
      });
      return ok(toSkill(skill as SkillRow, 1, skill.versions[0]?.id));
    },

    async save({ id, userId, source }: { id: SkillIdT; userId: UserId; source: SkillSource }) {
      const saved = await prisma.$transaction(async (tx) => {
        const latest = await tx.skillVersion.findFirst({
          where: { skillId: id, skill: { userId } },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        if (!latest) return null;

        const nextRevision = latest.revision + 1;
        const skill = await tx.skill.updateManyAndReturn({
          where: { id, userId },
          data: columns(source),
        });
        if (skill.length === 0) return null;

        const version = await tx.skillVersion.create({
          data: { skillId: id, revision: nextRevision, ...columns(source) },
          select: { id: true },
        });
        return { skill: skill[0], revision: nextRevision, versionId: version.id };
      });
      if (!saved) return err(domainError("not_found", `No skill ${id}.`));
      return ok(toSkill(saved.skill as SkillRow, saved.revision, saved.versionId));
    },

    async findById(id, userId) {
      const row = await prisma.skill.findFirst({
        where: { id, userId },
        include: { versions: { orderBy: { revision: "desc" }, take: 1, select: { id: true, revision: true } } },
      });
      return ok(row ? toSkill(row as SkillRow, row.versions[0]?.revision ?? 0, row.versions[0]?.id) : null);
    },

    async listByUser(userId) {
      const rows = await prisma.skill.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { versions: { orderBy: { revision: "desc" }, take: 1, select: { id: true, revision: true } } },
      });
      return ok(rows.map((r) => toSkill(r as SkillRow, r.versions[0]?.revision ?? 0, r.versions[0]?.id)));
    },
  };
}

/** Narrow Prisma's runtime errors into a domain error at the boundary. */
export function asDomainError(cause: unknown) {
  return err(domainError("persistence_failed", "A database operation failed.", cause));
}
