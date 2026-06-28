import type { Result, SkillBranchId, SkillId, UserId, DomainError } from "@/shared";
import type {
  RetentionReport,
  Skill,
  SkillBranch,
  SkillSource,
  SkillVersion,
} from "./skill.types";

/**
 * Persistence port for skills. The domain owns this interface; infra supplies
 * implementations (Prisma, in-memory). Append-only versioning lives behind
 * `save` — each save records a new revision (see ARCHITECTURE §6).
 *
 * The branch/promote methods are the iteration substrate (ARCHITECTURE §9.3):
 * a draft is a branch of revisions that accumulates *without moving the main
 * pointer*; promote re-points it. The linear methods (`save`/`restore`/
 * `listVersions`) keep operating on the main lineage, so existing reads are
 * unchanged. Pruning is **not** on this write path — it is a daily job behind
 * `SkillRetentionRepository`.
 */
export interface SkillRepository {
  create(input: {
    userId: UserId;
    source: SkillSource;
  }): Promise<Result<Skill, DomainError>>;

  checkpoint(input: {
    id?: SkillId;
    userId: UserId;
    source: SkillSource;
  }): Promise<Result<Skill, DomainError>>;

  save(input: {
    id: SkillId;
    userId: UserId;
    source: SkillSource;
  }): Promise<Result<Skill, DomainError>>;

  restore(input: {
    id: SkillId;
    userId: UserId;
    revision: number;
  }): Promise<Result<Skill, DomainError>>;

  findById(id: SkillId, userId: UserId): Promise<Result<Skill | null, DomainError>>;

  listByUser(userId: UserId): Promise<Result<readonly Skill[], DomainError>>;

  listVersions(id: SkillId, userId: UserId): Promise<Result<readonly SkillVersion[], DomainError>>;

  delete(id: SkillId, userId: UserId): Promise<Result<void, DomainError>>;

  // --- Branching iteration (ARCHITECTURE §9.3) -----------------------------

  /** Fork a fresh draft off the skill's current main version. The new branch is
   * seeded with a copy of that version (its first revision), so it has a head to
   * edit immediately. The main pointer does not move. */
  createBranch(input: {
    id: SkillId;
    userId: UserId;
  }): Promise<Result<SkillBranch, DomainError>>;

  /** Append a revision to a draft (append-only). Does not move the main pointer. */
  saveToBranch(input: {
    id: SkillId;
    userId: UserId;
    branchId: SkillBranchId;
    source: SkillSource;
  }): Promise<Result<SkillVersion, DomainError>>;

  /** All of a skill's branches (drafts + main), `isMain` derived. */
  listBranches(id: SkillId, userId: UserId): Promise<Result<readonly SkillBranch[], DomainError>>;

  /** A single branch's revisions, newest first. */
  listBranchVersions(
    id: SkillId,
    userId: UserId,
    branchId: SkillBranchId,
  ): Promise<Result<readonly SkillVersion[], DomainError>>;

  /** Set a draft as the main version — re-point the blessed pointer to its head.
   * Append-only (no version is created or mutated); last-promote-wins. */
  promoteBranch(input: {
    id: SkillId;
    userId: UserId;
    branchId: SkillBranchId;
  }): Promise<Result<Skill, DomainError>>;

  /** Drop a draft (status → discarded). The main lineage cannot be discarded. */
  discardBranch(input: {
    id: SkillId;
    userId: UserId;
    branchId: SkillBranchId;
  }): Promise<Result<void, DomainError>>;
}

/**
 * Retention port — the **daily cleanup job, off the write path** (ARCHITECTURE
 * §6, §9.3). Moving pruning here dissolves the "don't prune an in-flight draft
 * out from under the user" hazard by construction: nothing is pruned while a
 * session is live. It enforces two axes and never touches the main lineage or
 * any open draft's tip — only interior draft history beyond `keepPerBranch`.
 */
export interface SkillRetentionRepository {
  prune(input: {
    /** Latest-N revisions kept per draft branch. */
    keepPerBranch: number;
    /** Open drafts per skill kept; the oldest excess are discarded. */
    maxOpenDrafts: number;
  }): Promise<Result<RetentionReport, DomainError>>;
}
