import type { PrismaClient } from "@prisma/client";
import type { Publication, PublicationRepository, TapRepositorySkill } from "@/modules/publication";
import {
  domainError,
  err,
  ok,
  PublicationId,
  SkillId,
  SkillVersionId,
  UserId,
} from "@/shared";

type PublicationRow = {
  id: string;
  publisherId: string;
  skillId: string;
  skillVersionId: string;
  slug: string;
  tier: string;
  contentHash: string;
  createdAt: Date;
};

type TapRepositoryPublicationRow = PublicationRow & {
  skillVersion: {
    name: string;
    description: string;
    body: string;
    frontmatterJson: unknown;
  };
};

function toPublication(row: PublicationRow): Publication {
  return {
    id: PublicationId(row.id),
    publisherId: UserId(row.publisherId),
    skillId: SkillId(row.skillId),
    skillVersionId: SkillVersionId(row.skillVersionId),
    slug: row.slug,
    tier: row.tier === "reviewed" ? "reviewed" : row.tier === "published" ? "published" : "private",
    contentHash: row.contentHash,
    createdAt: row.createdAt,
  };
}

function toTapRepositorySkill(row: TapRepositoryPublicationRow): TapRepositorySkill {
  return {
    publication: toPublication(row),
    source: {
      frontmatter: {
        name: row.skillVersion.name,
        description: row.skillVersion.description,
        extra: (row.skillVersion.frontmatterJson as Record<string, unknown>) ?? {},
      },
      body: row.skillVersion.body,
    },
  };
}

export function createPrismaPublicationRepository(prisma: PrismaClient): PublicationRepository {
  return {
    async create(input) {
      const ownedVersion = await prisma.skillVersion.findFirst({
        where: { id: input.skillVersionId, skillId: input.skillId, skill: { userId: input.publisherId } },
        select: { id: true },
      });
      if (!ownedVersion) {
        return err(domainError("not_found", `No skill version ${input.skillVersionId}.`));
      }

      const slug = `${input.slug.owner}/${input.slug.name}`;
      const existing = await prisma.publication.findUnique({ where: { slug }, select: { id: true } });
      if (existing) {
        return err(domainError("invalid_operation", `Publication slug ${slug} already exists.`));
      }

      const row = await prisma.publication.create({
        data: {
          publisherId: input.publisherId,
          skillId: input.skillId,
          skillVersionId: input.skillVersionId,
          slug,
          tier: input.tier,
          contentHash: input.contentHash,
        },
      });
      return ok(toPublication(row as PublicationRow));
    },

    async findById(id) {
      const row = await prisma.publication.findUnique({ where: { id } });
      return ok(row ? toPublication(row as PublicationRow) : null);
    },

    async findBySlug(slug) {
      const row = await prisma.publication.findUnique({ where: { slug } });
      return ok(row ? toPublication(row as PublicationRow) : null);
    },

    async listVisible() {
      const rows = await prisma.publication.findMany({
        where: { tier: { in: ["published", "reviewed"] } },
        orderBy: { slug: "asc" },
      });
      return ok(rows.map((row) => toPublication(row as PublicationRow)));
    },

    async listTapRepositorySkills() {
      const rows = await prisma.publication.findMany({
        where: { tier: { in: ["published", "reviewed"] } },
        include: {
          skillVersion: {
            select: {
              name: true,
              description: true,
              body: true,
              frontmatterJson: true,
            },
          },
        },
        orderBy: { slug: "asc" },
      });
      return ok(rows.map((row) => toTapRepositorySkill(row as TapRepositoryPublicationRow)));
    },

    async listByPublisher(publisherId) {
      const rows = await prisma.publication.findMany({ where: { publisherId }, orderBy: { createdAt: "desc" } });
      return ok(rows.map((row) => toPublication(row as PublicationRow)));
    },

    async listByVersion(skillVersionId) {
      const rows = await prisma.publication.findMany({
        where: { skillVersionId },
        orderBy: { createdAt: "desc" },
      });
      return ok(rows.map((row) => toPublication(row as PublicationRow)));
    },
  };
}
