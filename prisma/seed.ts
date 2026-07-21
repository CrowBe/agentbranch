import { baselineSkillCorpus } from "@/modules/baseline-corpus";
import { parseSkillMd, serializeSkillMd } from "@/modules/skill";
import { createPrismaClient } from "@/infra/prisma/client";
import { isErr } from "@/shared";
import type { Prisma } from "@prisma/client";

const SYSTEM_PUBLISHER_ID = "system:agentbranch";
const SYSTEM_PUBLISHER_EMAIL = "skills@agentbranch.dev";

export type BaselineSeedRecord = {
  readonly corpusId: string;
  readonly skillId: string;
  readonly branchId: string;
  readonly versionId: string;
  readonly publicationId: string;
  readonly slug: string;
  readonly contentHash: string;
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly frontmatterJson: Prisma.InputJsonObject;
};

/** Build and validate the deterministic rows before opening a transaction. */
export function baselineSeedRecords(): readonly BaselineSeedRecord[] {
  return baselineSkillCorpus.map((entry) => {
    const parsed = parseSkillMd(entry.source);
    if (isErr(parsed)) {
      throw new Error(`Baseline skill ${entry.id} is not valid SKILL.md: ${parsed.error.message}`);
    }
    if (serializeSkillMd(parsed.value) !== entry.source) {
      throw new Error(`Baseline skill ${entry.id} does not round-trip to its fixture bytes.`);
    }

    const prefix = `system:baseline:${entry.id}`;
    return {
      corpusId: entry.id,
      skillId: `${prefix}:skill`,
      branchId: `${prefix}:branch`,
      versionId: `${prefix}:version:1`,
      publicationId: `${prefix}:publication`,
      slug: `agentbranch/${entry.name}`,
      contentHash: `sha256:${entry.contentHash}`,
      name: parsed.value.frontmatter.name,
      description: parsed.value.frontmatter.description,
      body: parsed.value.body,
      frontmatterJson: parsed.value.frontmatter.extra as Prisma.InputJsonObject,
    };
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required to seed the database.");

  const prisma = createPrismaClient(databaseUrl);
  try {
    const records = baselineSeedRecords();
    await prisma.$transaction(async (tx) => {
      await tx.user.upsert({
        where: { id: SYSTEM_PUBLISHER_ID },
        create: { id: SYSTEM_PUBLISHER_ID, email: SYSTEM_PUBLISHER_EMAIL },
        update: { email: SYSTEM_PUBLISHER_EMAIL },
      });

      for (const record of records) {
        const source = {
          name: record.name,
          description: record.description,
          body: record.body,
          frontmatterJson: record.frontmatterJson,
        };
        await tx.skill.upsert({
          where: { id: record.skillId },
          create: { id: record.skillId, userId: SYSTEM_PUBLISHER_ID, ...source },
          update: { userId: SYSTEM_PUBLISHER_ID, ...source },
        });
        await tx.skillBranch.upsert({
          where: { id: record.branchId },
          create: { id: record.branchId, skillId: record.skillId, ordinal: 1 },
          update: { skillId: record.skillId, status: "open", ordinal: 1 },
        });
        await tx.skillVersion.upsert({
          where: { id: record.versionId },
          create: {
            id: record.versionId,
            skillId: record.skillId,
            branchId: record.branchId,
            revision: 1,
            ...source,
          },
          update: {
            skillId: record.skillId,
            branchId: record.branchId,
            revision: 1,
            parentId: null,
            ...source,
          },
        });
        await tx.skill.update({
          where: { id: record.skillId },
          data: { mainVersionId: record.versionId },
        });
        await tx.publication.upsert({
          where: { id: record.publicationId },
          create: {
            id: record.publicationId,
            publisherId: SYSTEM_PUBLISHER_ID,
            skillId: record.skillId,
            skillVersionId: record.versionId,
            slug: record.slug,
            tier: "reviewed",
            contentHash: record.contentHash,
          },
          update: {
            publisherId: SYSTEM_PUBLISHER_ID,
            skillId: record.skillId,
            skillVersionId: record.versionId,
            slug: record.slug,
            tier: "reviewed",
            contentHash: record.contentHash,
          },
        });
      }
    });
    console.info(`Seeded ${records.length} reviewed agentbranch skills.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((cause: unknown) => {
    console.error(cause);
    process.exitCode = 1;
  });
}
