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

    async save({ id, source }: { id: SkillIdT; source: SkillSource }) {
      const latest = await prisma.skillVersion.findFirst({
        where: { skillId: id },
        orderBy: { revision: "desc" },
        select: { revision: true },
      });
      const nextRevision = (latest?.revision ?? 0) + 1;
      const skill = await prisma.skill.update({
        where: { id },
        data: {
          ...columns(source),
          versions: { create: { revision: nextRevision, ...columns(source) } },
        },
        include: { versions: { orderBy: { revision: "desc" }, take: 1, select: { id: true } } },
      });
      return ok(toSkill(skill as SkillRow, nextRevision, skill.versions[0]?.id));
    },

    async findById(id) {
      const row = await prisma.skill.findUnique({
        where: { id },
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
