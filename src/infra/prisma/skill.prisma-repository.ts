import type { PrismaClient } from "@prisma/client";
import {
  makeSkill,
  type Skill,
  type SkillSource,
  type SkillRepository,
} from "@/modules/skill";
import { ok, err, SkillId, UserId, domainError, type SkillId as SkillIdT } from "@/shared";

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
function toSkill(row: SkillRow, latestRevision: number): Skill {
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
      });
      return ok(toSkill(skill as SkillRow, 1));
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
      });
      return ok(toSkill(skill as SkillRow, nextRevision));
    },

    async findById(id) {
      const row = await prisma.skill.findUnique({
        where: { id },
        include: { versions: { orderBy: { revision: "desc" }, take: 1, select: { revision: true } } },
      });
      return ok(row ? toSkill(row as SkillRow, row.versions[0]?.revision ?? 0) : null);
    },

    async listByUser(userId) {
      const rows = await prisma.skill.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { versions: { orderBy: { revision: "desc" }, take: 1, select: { revision: true } } },
      });
      return ok(rows.map((r) => toSkill(r as SkillRow, r.versions[0]?.revision ?? 0)));
    },
  };
}

/** Narrow Prisma's runtime errors into a domain error at the boundary. */
export function asDomainError(cause: unknown) {
  return err(domainError("persistence_failed", "A database operation failed.", cause));
}
