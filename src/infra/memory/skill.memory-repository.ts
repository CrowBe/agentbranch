import {
  makeSkill,
  reviseSkill,
  type RetentionReport,
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
  type UserId,
  type SkillId as SkillIdT,
  type SkillBranchId as SkillBranchIdT,
  domainError,
} from "@/shared";

/**
 * The in-memory store the skill repository and its retention job share, so the
 * daily prune sees the same branches/versions the write path produced. One
 * store per app boot (or per test); `createMemorySkillRepository()` makes its
 * own when called bare, for the offline default and existing adapter tests.
 */
export type MemorySkillStore = {
  readonly skills: Map<string, Skill>;
  readonly versions: Map<string, SkillVersion[]>;
  readonly branches: Map<string, SkillBranch[]>;
};

export function createMemorySkillStore(): MemorySkillStore {
  return { skills: new Map(), versions: new Map(), branches: new Map() };
}

/** Versions of a branch, newest revision first. */
function branchVersions(store: MemorySkillStore, skillId: string, branchId: string): SkillVersion[] {
  return (store.versions.get(skillId) ?? [])
    .filter((version) => version.branchId === branchId)
    .sort((a, b) => b.revision - a.revision);
}

/** The branch a version belongs to, or undefined if the skill has no versions. */
function branchIdOfVersion(store: MemorySkillStore, skillId: string, versionId?: string): string | undefined {
  if (!versionId) return undefined;
  return (store.versions.get(skillId) ?? []).find((v) => v.id === versionId)?.branchId;
}

/** Decorate a stored branch with its derived head + `isMain` flag. */
function decorateBranch(store: MemorySkillStore, skill: Skill, branch: SkillBranch): SkillBranch {
  const head = branchVersions(store, skill.id, branch.id)[0];
  const mainBranchId = branchIdOfVersion(store, skill.id, skill.latestVersionId);
  return { ...branch, isMain: branch.id === mainBranchId, headVersionId: head?.id };
}

function appendVersion(
  store: MemorySkillStore,
  skillId: SkillIdT,
  branchId: SkillBranchIdT,
  source: SkillSource,
  parentId: SkillVersionId | undefined,
  now: Date,
): SkillVersion {
  const revision = (branchVersions(store, skillId, branchId)[0]?.revision ?? 0) + 1;
  const version: SkillVersion = {
    id: SkillVersionId(crypto.randomUUID()),
    skillId,
    branchId,
    parentId,
    revision,
    source,
    lintSummary: createLintSummary(source),
    createdAt: now,
  };
  store.versions.set(skillId, [...(store.versions.get(skillId) ?? []), version]);
  return version;
}

/** Open the skill's main branch, creating it lazily if the first version is
 * being recorded after a no-version checkpoint. */
function ensureMainBranch(store: MemorySkillStore, skill: Skill, now: Date): SkillBranchIdT {
  const existing = branchIdOfVersion(store, skill.id, skill.latestVersionId);
  if (existing) return SkillBranchId(existing);
  const branch: SkillBranch = {
    id: SkillBranchId(crypto.randomUUID()),
    skillId: skill.id,
    status: "open",
    ordinal: 0,
    isMain: true,
    createdAt: now,
    updatedAt: now,
  };
  store.branches.set(skill.id, [...(store.branches.get(skill.id) ?? []), branch]);
  return branch.id;
}

/**
 * In-memory SkillRepository — the default adapter so the app runs with no DB
 * (ARCHITECTURE: persistence falls back to memory absent DATABASE_URL). Also
 * the adapter domain tests run against.
 */
export function createMemorySkillRepository(
  store: MemorySkillStore = createMemorySkillStore(),
): SkillRepository {
  const { skills, branches } = store;

  function owned(id: string, userId: UserId): Skill | null {
    const skill = skills.get(id);
    return skill && skill.userId === userId ? skill : null;
  }

  return {
    async create({ userId, source }) {
      const now = new Date();
      const skillId = SkillId(crypto.randomUUID());
      const branch: SkillBranch = {
        id: SkillBranchId(crypto.randomUUID()),
        skillId,
        status: "open",
        ordinal: 0,
        isMain: true,
        createdAt: now,
        updatedAt: now,
      };
      branches.set(skillId, [branch]);
      const version = appendVersion(store, skillId, branch.id, source, undefined, now);
      const skill = makeSkill({
        id: skillId,
        userId,
        source,
        latestRevision: version.revision,
        latestVersionId: version.id,
        createdAt: now,
        updatedAt: now,
      });
      skills.set(skill.id, skill);
      return ok(skill);
    },

    async checkpoint({ id, userId, source }: { id?: SkillIdT; userId: UserId; source: SkillSource }) {
      const now = new Date();
      if (id) {
        const existing = owned(id, userId);
        if (!existing) return err(domainError("not_found", `No skill ${id}.`));
        const next = { ...existing, source, updatedAt: now };
        skills.set(id, next);
        return ok(next);
      }

      const skillId = SkillId(crypto.randomUUID());
      const skill = makeSkill({
        id: skillId,
        userId,
        source,
        latestRevision: 0,
        createdAt: now,
        updatedAt: now,
      });
      skills.set(skill.id, skill);
      store.versions.set(skill.id, []);
      branches.set(skill.id, []);
      return ok(skill);
    },

    async save({ id, userId, source }: { id: SkillIdT; userId: UserId; source: SkillSource }) {
      const existing = owned(id, userId);
      if (!existing) return err(domainError("not_found", `No skill ${id}.`));
      const now = new Date();
      const branchId = ensureMainBranch(store, existing, now);
      const version = appendVersion(store, id, branchId, source, existing.latestVersionId, now);
      const next = {
        ...reviseSkill(existing, source, now),
        latestRevision: version.revision,
        latestVersionId: version.id,
      };
      skills.set(id, next);
      return ok(next);
    },

    async restore({ id, userId, revision }: { id: SkillIdT; userId: UserId; revision: number }) {
      const existing = owned(id, userId);
      if (!existing) return err(domainError("not_found", `No skill ${id}.`));

      const mainBranchId = branchIdOfVersion(store, id, existing.latestVersionId);
      const version = mainBranchId
        ? branchVersions(store, id, mainBranchId).find((item) => item.revision === revision)
        : undefined;
      if (!version || !mainBranchId) {
        return err(domainError("not_found", `No revision ${revision} for skill ${id}.`));
      }

      const now = new Date();
      const appended = appendVersion(
        store,
        id,
        SkillBranchId(mainBranchId),
        version.source,
        existing.latestVersionId,
        now,
      );
      const next = {
        ...reviseSkill(existing, version.source, now),
        latestRevision: appended.revision,
        latestVersionId: appended.id,
      };
      skills.set(id, next);
      return ok(next);
    },

    async findById(id, userId) {
      return ok(owned(id, userId));
    },

    async listByUser(userId: UserId) {
      return ok([...skills.values()].filter((s) => s.userId === userId));
    },

    async listVersions(id, userId) {
      const skill = owned(id, userId);
      if (!skill) return ok([]);
      const mainBranchId = branchIdOfVersion(store, id, skill.latestVersionId);
      return ok(mainBranchId ? branchVersions(store, id, mainBranchId) : []);
    },

    async delete(id, userId) {
      if (!owned(id, userId)) return err(domainError("not_found", `No skill ${id}.`));
      skills.delete(id);
      store.versions.delete(id);
      branches.delete(id);
      return ok(undefined);
    },

    // --- Branching iteration ------------------------------------------------

    async createBranch({ id, userId }) {
      const skill = owned(id, userId);
      if (!skill || !skill.latestVersionId) return err(domainError("not_found", `No skill ${id}.`));
      const mainBranchId = branchIdOfVersion(store, id, skill.latestVersionId);
      const mainVersion = (store.versions.get(id) ?? []).find((v) => v.id === skill.latestVersionId);
      if (!mainBranchId || !mainVersion) return err(domainError("not_found", `No skill ${id}.`));

      const now = new Date();
      const skillBranches = branches.get(id) ?? [];
      const ordinal = Math.max(0, ...skillBranches.map((b) => b.ordinal)) + 1;
      const branch: SkillBranch = {
        id: SkillBranchId(crypto.randomUUID()),
        skillId: id,
        status: "open",
        ordinal,
        isMain: false,
        createdAt: now,
        updatedAt: now,
      };
      branches.set(id, [...skillBranches, branch]);
      // Seed the draft with a copy of the blessed version, parented to it.
      appendVersion(store, id, branch.id, mainVersion.source, skill.latestVersionId, now);
      return ok(decorateBranch(store, skill, branch));
    },

    async saveToBranch({ id, userId, branchId, source }) {
      const skill = owned(id, userId);
      if (!skill) return err(domainError("not_found", `No skill ${id}.`));
      const branch = (branches.get(id) ?? []).find((b) => b.id === branchId);
      if (!branch) return err(domainError("not_found", `No draft ${branchId}.`));
      if (branch.status === "discarded") {
        return err(domainError("invalid_operation", "This draft has been discarded."));
      }
      if (branch.id === branchIdOfVersion(store, id, skill.latestVersionId)) {
        return err(domainError("invalid_operation", "The main version must be edited through the main save path."));
      }
      const now = new Date();
      const parentId = branchVersions(store, id, branchId)[0]?.id;
      const version = appendVersion(store, id, SkillBranchId(branchId), source, parentId, now);
      branches.set(
        id,
        (branches.get(id) ?? []).map((b) => (b.id === branchId ? { ...b, updatedAt: now } : b)),
      );
      return ok(version);
    },

    async listBranches(id, userId) {
      const skill = owned(id, userId);
      if (!skill) return ok([]);
      return ok(
        (branches.get(id) ?? [])
          .map((branch) => decorateBranch(store, skill, branch))
          .sort((a, b) => a.ordinal - b.ordinal),
      );
    },

    async listBranchVersions(id, userId, branchId) {
      const skill = owned(id, userId);
      if (!skill) return ok([]);
      return ok(branchVersions(store, id, branchId));
    },

    async promoteBranch({ id, userId, branchId }) {
      const skill = owned(id, userId);
      if (!skill) return err(domainError("not_found", `No skill ${id}.`));
      const branch = (branches.get(id) ?? []).find((b) => b.id === branchId);
      if (!branch || branch.status === "discarded") {
        return err(domainError("not_found", `No draft ${branchId}.`));
      }
      const head = branchVersions(store, id, branchId)[0];
      if (!head) return err(domainError("invalid_operation", "This draft has no revisions to promote."));

      const now = new Date();
      // Append-only: no version is created or mutated — only the blessed pointer
      // moves to the draft's head, so that draft becomes the main lineage.
      const next = {
        ...skill,
        source: head.source,
        latestRevision: head.revision,
        latestVersionId: head.id,
        updatedAt: now,
      };
      skills.set(id, next);
      return ok(next);
    },

    async discardBranch({ id, userId, branchId }) {
      const skill = owned(id, userId);
      if (!skill) return err(domainError("not_found", `No skill ${id}.`));
      const skillBranches = branches.get(id) ?? [];
      const branch = skillBranches.find((b) => b.id === branchId);
      if (!branch) return err(domainError("not_found", `No draft ${branchId}.`));
      const mainBranchId = branchIdOfVersion(store, id, skill.latestVersionId);
      if (branch.id === mainBranchId) {
        return err(domainError("invalid_operation", "The main version's draft cannot be discarded."));
      }
      branches.set(
        id,
        skillBranches.map((b) =>
          b.id === branchId ? { ...b, status: "discarded" as const, updatedAt: new Date() } : b,
        ),
      );
      return ok(undefined);
    },
  };
}

/**
 * In-memory retention job over the shared store (ARCHITECTURE §9.3). Off the
 * write path: it prunes interior draft history beyond `keepPerBranch` and caps
 * open drafts, never touching the main lineage or any draft's tip.
 */
export function createMemorySkillRetentionRepository(
  store: MemorySkillStore,
): SkillRetentionRepository {
  return {
    async prune({ keepPerBranch, maxOpenDrafts }) {
      let prunedVersions = 0;
      let discardedBranches = 0;

      for (const [skillId, skill] of store.skills) {
        const mainBranchId = branchIdOfVersion(store, skillId, skill.latestVersionId);
        const skillBranches = store.branches.get(skillId) ?? [];

        // Axis 1 — per-draft depth. The main lineage is never pruned.
        const removed = new Set<string>();
        for (const branch of skillBranches) {
          if (branch.id === mainBranchId) continue;
          const ordered = branchVersions(store, skillId, branch.id); // newest first
          for (const version of ordered.slice(keepPerBranch)) removed.add(version.id);
        }
        if (removed.size > 0) {
          prunedVersions += removed.size;
          const kept = (store.versions.get(skillId) ?? [])
            .filter((v) => !removed.has(v.id))
            // Mirror the DB's onDelete: SetNull — children of a pruned version
            // keep their identity, just lose the dangling parent pointer.
            .map((v) => (v.parentId && removed.has(v.parentId) ? { ...v, parentId: undefined } : v));
          store.versions.set(skillId, kept);
        }

        // Axis 2 — open-drafts-per-skill cap; discard the oldest excess.
        const openDrafts = skillBranches
          .filter((b) => b.status === "open" && b.id !== mainBranchId)
          .sort((a, b) => a.ordinal - b.ordinal);
        const excess = openDrafts.slice(0, Math.max(0, openDrafts.length - maxOpenDrafts));
        if (excess.length > 0) {
          const excessIds = new Set(excess.map((b) => b.id));
          discardedBranches += excess.length;
          store.branches.set(
            skillId,
            skillBranches.map((b) =>
              excessIds.has(b.id) ? { ...b, status: "discarded" as const } : b,
            ),
          );
        }
      }

      return ok({ prunedVersions, discardedBranches });
    },
  };
}
