import type { PrismaClient } from "@prisma/client";
import {
  makeSkill,
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

type SkillVersionRow = {
  id: string;
  skillId: string;
  revision: number;
  name: string;
  description: string;
  body: string;
  frontmatterJson: unknown;
  createdAt: Date;
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

function toSkillVersion(row: SkillVersionRow): SkillVersion {
  return {
    id: SkillVersionId(row.id),
    skillId: SkillId(row.skillId),
    revision: row.revision,
    source: {
      frontmatter: {
        name: row.name,
        description: row.description,
        extra: (row.frontmatterJson as Record<string, unknown>) ?? {},
      },
      body: row.body,
    },
    createdAt: row.createdAt,
  };
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
        await pruneOldVersions(tx, id);
        return { skill: skill[0], revision: nextRevision, versionId: version.id };
      });
      if (!saved) return err(domainError("not_found", `No skill ${id}.`));
      return ok(toSkill(saved.skill as SkillRow, saved.revision, saved.versionId));
    },

    async restore({ id, userId, revision }: { id: SkillIdT; userId: UserId; revision: number }) {
      const restored = await prisma.$transaction(async (tx) => {
        const target = await tx.skillVersion.findFirst({
          where: { skillId: id, revision, skill: { userId } },
        });
        if (!target) return null;

        const latest = await tx.skillVersion.findFirst({
          where: { skillId: id, skill: { userId } },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        if (!latest) return null;

        const nextRevision = latest.revision + 1;
        const source = toSkillVersion(target as SkillVersionRow).source;
        const skill = await tx.skill.updateManyAndReturn({
          where: { id, userId },
          data: columns(source),
        });
        if (skill.length === 0) return null;

        const version = await tx.skillVersion.create({
          data: { skillId: id, revision: nextRevision, ...columns(source) },
          select: { id: true },
        });
        await pruneOldVersions(tx, id);
        return { skill: skill[0], revision: nextRevision, versionId: version.id };
      });
      if (!restored) return err(domainError("not_found", `No revision ${revision} for skill ${id}.`));
      return ok(toSkill(restored.skill as SkillRow, restored.revision, restored.versionId));
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

    async listVersions(id, userId) {
      const rows = await prisma.skillVersion.findMany({
        where: { skillId: id, skill: { userId } },
        orderBy: { revision: "desc" },
      });
      return ok(rows.map((row) => toSkillVersion(row as SkillVersionRow)));
    },

    async delete(id, userId) {
      const deleted = await prisma.skill.deleteMany({
        where: { id, userId },
      });
      if (deleted.count === 0) return err(domainError("not_found", `No skill ${id}.`));
      return ok(undefined);
    },
  };
}

/** Narrow Prisma's runtime errors into a domain error at the boundary. */
export function asDomainError(cause: unknown) {
  return err(domainError("persistence_failed", "A database operation failed.", cause));
}

async function pruneOldVersions(
  tx: Pick<PrismaClient, "skillVersion">,
  skillId: SkillIdT,
): Promise<void> {
  const excess = await tx.skillVersion.findMany({
    where: { skillId },
    orderBy: { revision: "desc" },
    skip: SKILL_VERSION_MAX,
    select: { id: true },
  });
  if (excess.length === 0) return;

  await tx.skillVersion.deleteMany({
    where: { id: { in: excess.map((version) => version.id) } },
  });
}
