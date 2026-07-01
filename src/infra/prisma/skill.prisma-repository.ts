import type { PrismaClient } from "@prisma/client";
import {
  makeSkill,
  type Skill,
  type SkillBranch,
  type SkillSource,
  type SkillVersion,
  type SkillRepository,
  type SkillRetentionRepository,
} from "@/modules/skill";
import { createLintSummary } from "@/modules/lint";
import {
  ok,
  err,
  SkillBranchId,
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
  mainVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type SkillVersionRow = {
  id: string;
  skillId: string;
  branchId: string;
  parentId: string | null;
  revision: number;
  name: string;
  description: string;
  body: string;
  frontmatterJson: unknown;
  lintSummaryJson: unknown | null;
  createdAt: Date;
};

type SkillBranchRow = {
  id: string;
  skillId: string;
  status: string;
  ordinal: number;
  createdAt: Date;
  updatedAt: Date;
};

/** Rehydrate the Skill aggregate; the main version is the blessed pointer. */
function toSkill(row: SkillRow, main?: { id: string; revision: number } | null): Skill {
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
    latestRevision: main?.revision ?? 0,
    latestVersionId: main ? SkillVersionId(main.id) : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toSkillVersion(row: SkillVersionRow): SkillVersion {
  return {
    id: SkillVersionId(row.id),
    skillId: SkillId(row.skillId),
    branchId: SkillBranchId(row.branchId),
    parentId: row.parentId ? SkillVersionId(row.parentId) : undefined,
    revision: row.revision,
    source: {
      frontmatter: {
        name: row.name,
        description: row.description,
        extra: (row.frontmatterJson as Record<string, unknown>) ?? {},
      },
      body: row.body,
    },
    lintSummary:
      row.lintSummaryJson === null ? undefined : (row.lintSummaryJson as SkillVersion["lintSummary"]),
    createdAt: row.createdAt,
  };
}

function toSkillBranch(row: SkillBranchRow, mainBranchId: string | null, headVersionId?: string): SkillBranch {
  return {
    id: SkillBranchId(row.id),
    skillId: SkillId(row.skillId),
    status: row.status === "discarded" ? "discarded" : "open",
    ordinal: row.ordinal,
    isMain: row.id === mainBranchId,
    headVersionId: headVersionId ? SkillVersionId(headVersionId) : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const columns = (source: SkillSource) => ({
  name: source.frontmatter.name,
  description: source.frontmatter.description,
  body: source.body,
  frontmatterJson: source.frontmatter.extra as object,
});

const versionColumns = (source: SkillSource) => ({
  ...columns(source),
  lintSummaryJson: createLintSummary(source),
});

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** The main branch id for a skill (the branch owning its main version), if any. */
async function mainBranchId(tx: Tx, skill: { mainVersionId: string | null }): Promise<string | null> {
  if (!skill.mainVersionId) return null;
  const version = await tx.skillVersion.findUnique({
    where: { id: skill.mainVersionId },
    select: { branchId: true },
  });
  return version?.branchId ?? null;
}

/** Next per-branch display ordinal + the current head version id. */
async function branchTip(tx: Tx, branchId: string): Promise<{ revision: number; headId?: string }> {
  const head = await tx.skillVersion.findFirst({
    where: { branchId },
    orderBy: { revision: "desc" },
    select: { revision: true, id: true },
  });
  return { revision: head?.revision ?? 0, headId: head?.id };
}

/**
 * Prisma SkillRepository (real). Each create/save also appends a SkillVersion so
 * an export is a pure function of a version (ARCHITECTURE §6). Branch/promote is
 * the iteration substrate (§9.3); pruning is *not* here — it is the daily job in
 * `createPrismaSkillRetentionRepository`.
 */
export function createPrismaSkillRepository(prisma: PrismaClient): SkillRepository {
  return {
    async create({ userId, source }) {
      const created = await prisma.$transaction(async (tx) => {
        const skill = await tx.skill.create({ data: { userId, ...columns(source) } });
        const branch = await tx.skillBranch.create({
          data: { skillId: skill.id, ordinal: 0, status: "open" },
        });
        const version = await tx.skillVersion.create({
          data: { skillId: skill.id, branchId: branch.id, revision: 1, ...versionColumns(source) },
          select: { id: true },
        });
        const updated = await tx.skill.update({
          where: { id: skill.id },
          data: { mainVersionId: version.id },
        });
        return { skill: updated, versionId: version.id };
      });
      return ok(toSkill(created.skill as SkillRow, { id: created.versionId, revision: 1 }));
    },

    async checkpoint({ id, userId, source }: { id?: SkillIdT; userId: UserId; source: SkillSource }) {
      if (!id) {
        const skill = await prisma.skill.create({ data: { userId, ...columns(source) } });
        return ok(toSkill(skill as SkillRow, null));
      }

      const saved = await prisma.$transaction(async (tx) => {
        const [updated] = await tx.skill.updateManyAndReturn({ where: { id, userId }, data: columns(source) });
        if (!updated) return null;
        const main = updated.mainVersionId
          ? await tx.skillVersion.findUnique({
              where: { id: updated.mainVersionId },
              select: { id: true, revision: true },
            })
          : null;
        return { skill: updated, main };
      });
      if (!saved) return err(domainError("not_found", `No skill ${id}.`));
      return ok(toSkill(saved.skill as SkillRow, saved.main));
    },

    async save({ id, userId, source }: { id: SkillIdT; userId: UserId; source: SkillSource }) {
      const saved = await prisma.$transaction(async (tx) => {
        const existing = await tx.skill.findFirst({ where: { id, userId } });
        if (!existing) return null;

        // Append to the main branch, creating it lazily after a no-version checkpoint.
        let branchId = await mainBranchId(tx, existing);
        if (!branchId) {
          const branch = await tx.skillBranch.create({
            data: { skillId: id, ordinal: 0, status: "open" },
          });
          branchId = branch.id;
        }
        const { revision: prevRevision } = await branchTip(tx, branchId);
        const version = await tx.skillVersion.create({
          data: {
            skillId: id,
            branchId,
            parentId: existing.mainVersionId,
            revision: prevRevision + 1,
            ...versionColumns(source),
          },
          select: { id: true, revision: true },
        });
        const updated = await tx.skill.update({
          where: { id },
          data: { ...columns(source), mainVersionId: version.id },
        });
        return { skill: updated, main: version };
      });
      if (!saved) return err(domainError("not_found", `No skill ${id}.`));
      return ok(toSkill(saved.skill as SkillRow, saved.main));
    },

    async restore({ id, userId, revision }: { id: SkillIdT; userId: UserId; revision: number }) {
      const restored = await prisma.$transaction(async (tx) => {
        const existing = await tx.skill.findFirst({ where: { id, userId } });
        if (!existing) return null;
        const branchId = await mainBranchId(tx, existing);
        if (!branchId) return null;

        const target = await tx.skillVersion.findFirst({ where: { branchId, revision } });
        if (!target) return null;

        const { revision: prevRevision } = await branchTip(tx, branchId);
        const source = toSkillVersion(target as SkillVersionRow).source;
        const version = await tx.skillVersion.create({
          data: {
            skillId: id,
            branchId,
            parentId: existing.mainVersionId,
            revision: prevRevision + 1,
            ...versionColumns(source),
          },
          select: { id: true, revision: true },
        });
        const updated = await tx.skill.update({
          where: { id },
          data: { ...columns(source), mainVersionId: version.id },
        });
        return { skill: updated, main: version };
      });
      if (!restored) return err(domainError("not_found", `No revision ${revision} for skill ${id}.`));
      return ok(toSkill(restored.skill as SkillRow, restored.main));
    },

    async findById(id, userId) {
      const row = await prisma.skill.findFirst({
        where: { id, userId },
        include: { mainVersion: { select: { id: true, revision: true } } },
      });
      return ok(row ? toSkill(row as SkillRow, row.mainVersion) : null);
    },

    async listByUser(userId) {
      const rows = await prisma.skill.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { mainVersion: { select: { id: true, revision: true } } },
      });
      return ok(rows.map((r) => toSkill(r as SkillRow, r.mainVersion)));
    },

    async listVersions(id, userId) {
      const skill = await prisma.skill.findFirst({ where: { id, userId }, select: { mainVersionId: true } });
      if (!skill) return ok([]);
      const branchId = await mainBranchId(prisma, skill);
      if (!branchId) return ok([]);
      const rows = await prisma.skillVersion.findMany({ where: { branchId }, orderBy: { revision: "desc" } });
      return ok(rows.map((row) => toSkillVersion(row as SkillVersionRow)));
    },

    async delete(id, userId) {
      const deleted = await prisma.skill.deleteMany({ where: { id, userId } });
      if (deleted.count === 0) return err(domainError("not_found", `No skill ${id}.`));
      return ok(undefined);
    },

    // --- Branching iteration ------------------------------------------------

    async createBranch({ id, userId }) {
      const created = await prisma.$transaction(async (tx) => {
        const skill = await tx.skill.findFirst({ where: { id, userId } });
        if (!skill || !skill.mainVersionId) return null;
        const mainVersion = await tx.skillVersion.findUnique({
          where: { id: skill.mainVersionId },
        });
        if (!mainVersion) return null;

        const top = await tx.skillBranch.findFirst({
          where: { skillId: id },
          orderBy: { ordinal: "desc" },
          select: { ordinal: true },
        });
        const branch = await tx.skillBranch.create({
          data: { skillId: id, ordinal: (top?.ordinal ?? 0) + 1, status: "open" },
        });
        const source = toSkillVersion(mainVersion as SkillVersionRow).source;
        const head = await tx.skillVersion.create({
          data: {
            skillId: id,
            branchId: branch.id,
            parentId: skill.mainVersionId,
            revision: 1,
            ...versionColumns(source),
          },
          select: { id: true },
        });
        return { branch, mainBranchId: mainVersion.branchId, headId: head.id };
      });
      if (!created) return err(domainError("not_found", `No skill ${id}.`));
      return ok(toSkillBranch(created.branch as SkillBranchRow, created.mainBranchId, created.headId));
    },

    async saveToBranch({ id, userId, branchId, source }) {
      const saved = await prisma.$transaction(async (tx) => {
        const skill = await tx.skill.findFirst({ where: { id, userId }, select: { id: true } });
        if (!skill) return { error: "not_found" as const };
        const branch = await tx.skillBranch.findFirst({ where: { id: branchId, skillId: id } });
        if (!branch) return { error: "not_found" as const };
        if (branch.status === "discarded") return { error: "discarded" as const };

        const { revision: prevRevision, headId } = await branchTip(tx, branchId);
        const version = await tx.skillVersion.create({
          data: { skillId: id, branchId, parentId: headId, revision: prevRevision + 1, ...versionColumns(source) },
        });
        await tx.skillBranch.update({ where: { id: branchId }, data: { updatedAt: new Date() } });
        return { version };
      });
      if ("error" in saved) {
        return saved.error === "discarded"
          ? err(domainError("invalid_operation", "This draft has been discarded."))
          : err(domainError("not_found", `No draft ${branchId}.`));
      }
      return ok(toSkillVersion(saved.version as SkillVersionRow));
    },

    async listBranches(id, userId) {
      const skill = await prisma.skill.findFirst({ where: { id, userId }, select: { mainVersionId: true } });
      if (!skill) return ok([]);
      const main = await mainBranchId(prisma, skill);
      const rows = await prisma.skillBranch.findMany({
        where: { skillId: id },
        orderBy: { ordinal: "asc" },
        include: { versions: { orderBy: { revision: "desc" }, take: 1, select: { id: true } } },
      });
      return ok(rows.map((row) => toSkillBranch(row as SkillBranchRow, main, row.versions[0]?.id)));
    },

    async listBranchVersions(id, userId, branchId) {
      const skill = await prisma.skill.findFirst({ where: { id, userId }, select: { id: true } });
      if (!skill) return ok([]);
      const rows = await prisma.skillVersion.findMany({
        where: { branchId, skillId: id },
        orderBy: { revision: "desc" },
      });
      return ok(rows.map((row) => toSkillVersion(row as SkillVersionRow)));
    },

    async promoteBranch({ id, userId, branchId }) {
      const promoted = await prisma.$transaction(async (tx) => {
        const skill = await tx.skill.findFirst({ where: { id, userId } });
        if (!skill) return { error: "not_found" as const };
        const branch = await tx.skillBranch.findFirst({ where: { id: branchId, skillId: id } });
        if (!branch || branch.status === "discarded") return { error: "not_found" as const };
        const head = await tx.skillVersion.findFirst({
          where: { branchId },
          orderBy: { revision: "desc" },
        });
        if (!head) return { error: "empty" as const };

        // Append-only: move the blessed pointer to the draft's head; that draft
        // becomes the main lineage. No version is created or mutated.
        const source = toSkillVersion(head as SkillVersionRow).source;
        const updated = await tx.skill.update({
          where: { id },
          data: { ...columns(source), mainVersionId: head.id },
        });
        return { skill: updated, main: { id: head.id, revision: head.revision } };
      });
      if ("error" in promoted) {
        return promoted.error === "empty"
          ? err(domainError("invalid_operation", "This draft has no revisions to promote."))
          : err(domainError("not_found", `No draft ${branchId}.`));
      }
      return ok(toSkill(promoted.skill as SkillRow, promoted.main));
    },

    async discardBranch({ id, userId, branchId }) {
      const result = await prisma.$transaction(async (tx) => {
        const skill = await tx.skill.findFirst({ where: { id, userId } });
        if (!skill) return { error: "not_found" as const };
        const branch = await tx.skillBranch.findFirst({ where: { id: branchId, skillId: id } });
        if (!branch) return { error: "not_found" as const };
        if (branchId === (await mainBranchId(tx, skill))) return { error: "is_main" as const };
        await tx.skillBranch.update({ where: { id: branchId }, data: { status: "discarded" } });
        return { error: null };
      });
      if (result.error === "is_main") {
        return err(domainError("invalid_operation", "The main version's draft cannot be discarded."));
      }
      if (result.error === "not_found") return err(domainError("not_found", `No draft ${branchId}.`));
      return ok(undefined);
    },
  };
}

/**
 * Prisma retention job — the daily cleanup off the write path (ARCHITECTURE
 * §9.3). Per-draft depth beyond `keepPerBranch` is deleted (never the main
 * lineage, never a draft's tip — `skip` always retains the head); open drafts
 * beyond `maxOpenDrafts` are discarded oldest-first. Pruned versions release
 * their run-record and child pointers via the schema's `onDelete: SetNull`.
 */
export function createPrismaSkillRetentionRepository(prisma: PrismaClient): SkillRetentionRepository {
  return {
    async prune({ keepPerBranch, maxOpenDrafts }) {
      let prunedVersions = 0;
      let discardedBranches = 0;

      const skills = await prisma.skill.findMany({ select: { id: true, mainVersionId: true } });
      for (const skill of skills) {
        const main = await mainBranchId(prisma, skill);
        const branches = await prisma.skillBranch.findMany({
          where: { skillId: skill.id },
          orderBy: { ordinal: "asc" },
        });

        for (const branch of branches) {
          if (branch.id === main) continue; // main lineage is never pruned
          const interior = await prisma.skillVersion.findMany({
            where: { branchId: branch.id },
            orderBy: { revision: "desc" },
            skip: keepPerBranch, // the tip is always within the kept window
            select: { id: true },
          });
          if (interior.length > 0) {
            await prisma.skillVersion.deleteMany({ where: { id: { in: interior.map((v) => v.id) } } });
            prunedVersions += interior.length;
          }
        }

        const openDrafts = branches.filter((b) => b.status === "open" && b.id !== main);
        const excess = openDrafts.slice(0, Math.max(0, openDrafts.length - maxOpenDrafts));
        if (excess.length > 0) {
          await prisma.skillBranch.updateMany({
            where: { id: { in: excess.map((b) => b.id) } },
            data: { status: "discarded" },
          });
          discardedBranches += excess.length;
        }
      }

      return ok({ prunedVersions, discardedBranches });
    },
  };
}

/** Narrow Prisma's runtime errors into a domain error at the boundary. */
export function asDomainError(cause: unknown) {
  return err(domainError("persistence_failed", "A database operation failed.", cause));
}
