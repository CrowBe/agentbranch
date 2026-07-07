import type { SkillBranchId, SkillId, SkillVersionId, UserId } from "@/shared";

/**
 * The YAML frontmatter of a SKILL.md. `name` and `description` are the two
 * fields Claude uses to decide whether to reach for a skill, so they are
 * first-class; anything else the author writes is preserved verbatim.
 */
export type Frontmatter = {
  readonly name: string;
  readonly description: string;
  readonly extra: Readonly<Record<string, unknown>>;
};

/**
 * The raw, source-of-truth representation of a skill: frontmatter + the
 * markdown body. This is what `parseSkillMd` produces and `serializeSkillMd`
 * round-trips. It carries no identity or persistence concerns.
 */
export type SkillSource = {
  readonly frontmatter: Frontmatter;
  readonly body: string;
};

/**
 * A persisted skill — `SkillSource` plus identity and timestamps. This is the
 * aggregate the rest of the app passes around; everything else (IR, render,
 * export, eval) is derived from it via the skill-analysis seam.
 *
 * `latestVersionId` is the skill's **main version** — the explicit blessed
 * pointer (ARCHITECTURE §6, §9.3). On the linear path it equals the newest
 * revision; promote re-points it to a draft's head. `latestRevision` is that
 * main version's per-branch display ordinal.
 */
export type Skill = {
  readonly id: SkillId;
  readonly userId: UserId;
  readonly source: SkillSource;
  readonly latestRevision: number;
  readonly latestVersionId?: SkillVersionId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type SkillVersionLintSummary = {
  readonly score: number;
  readonly grade: "A" | "B" | "C" | "D";
  readonly counts: Readonly<Record<"error" | "warn" | "info", number>>;
  /** Fired rule ids. Optional: versions persisted before the harness loop
   * landed carry a summary without it. */
  readonly rules?: readonly string[];
};

export type SkillVersion = {
  readonly id: SkillVersionId;
  readonly skillId: SkillId;
  readonly branchId: SkillBranchId;
  /** Parent in the version DAG; absent for a branch's first version. */
  readonly parentId?: SkillVersionId;
  /** Per-branch display ordinal (ARCHITECTURE §6), not a global revision. */
  readonly revision: number;
  readonly source: SkillSource;
  readonly lintSummary?: SkillVersionLintSummary;
  readonly createdAt: Date;
};

/** A draft is open until promoted-away or discarded; the retention job may
 * discard an over-cap draft (ARCHITECTURE §9.3). */
export type SkillBranchStatus = "open" | "discarded";

/**
 * A line of iteration — a **draft** in user copy (ARCHITECTURE §9.3). *Main is
 * just a branch*: `isMain` is derived (this branch owns the skill's main
 * version), never stored, so promote needs only to move the skill's pointer.
 */
export type SkillBranch = {
  readonly id: SkillBranchId;
  readonly skillId: SkillId;
  readonly status: SkillBranchStatus;
  readonly ordinal: number;
  readonly isMain: boolean;
  readonly headVersionId?: SkillVersionId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** What a daily retention pass removed — surfaced by the cron route for logging. */
export type RetentionReport = {
  readonly prunedVersions: number;
  readonly discardedBranches: number;
};

/** Failure modes when reading or validating a SKILL.md. */
export type SkillError =
  | { readonly tag: "invalid_frontmatter"; readonly message: string }
  | { readonly tag: "missing_name"; readonly message: string }
  | { readonly tag: "missing_description"; readonly message: string }
  | { readonly tag: "edit_no_match"; readonly message: string }
  | { readonly tag: "edit_invalid_skill"; readonly message: string };
