import type { AccountingTag } from "@/modules/model-gateway";
import type { Skill } from "@/modules/skill";
import type { Artifact, Insight } from "@/modules/skill-analysis";
import type {
  HarnessVersionId,
  SafetyRatingId,
  SkillId,
  SkillVersionId,
  UserId,
} from "@/shared";

export type SafetyReviewClass = "injection" | "exfiltration" | "deception";

export type SafetyReviewScore = {
  readonly class: SafetyReviewClass;
  /** 0 = no concern, 1 = clear severe concern. */
  readonly score: number;
  readonly rationale: string;
};

export type SafetyReviewInput = {
  readonly skill: Skill;
  /** Reference files in the exported skill folder. Contents are untrusted data. */
  readonly referenceFiles?: readonly SafetyReviewReferenceFile[];
  /**
   * Who pays for the review — declared by the caller because only it knows why
   * it is spending (CONTEXT.md → Accounting tag). The user's opt-in safety
   * rating passes `account` (capability `safety-review`, tier policy applies);
   * the publication gate (ARCHITECTURE §9.1) passes `platform`.
   */
  readonly tag: AccountingTag;
};

export type SafetyReviewReferenceFile = {
  readonly path: string;
  readonly content: string;
};

export type SafetyReviewVerdict = "passed" | "needs-review" | "blocked";

export type SafetyReviewResult = Artifact<"safety-review"> & {
  readonly verdict: SafetyReviewVerdict;
  readonly scores: readonly SafetyReviewScore[];
  readonly insight: Insight;
};

export type SafetyReviewBreakdown = {
  readonly verdict: SafetyReviewVerdict;
  readonly scores: readonly SafetyReviewScore[];
};

/**
 * The persisted **safety rating** — the Evaluation record of a safety review
 * (ARCHITECTURE §6, §9.1). A rating pins the skill version it reviewed;
 * versions are append-only, so a rating stays true for its version forever and
 * a new revision simply has no rating yet (unrated, never stale).
 */
export type SafetyRating = {
  readonly id: SafetyRatingId;
  readonly userId: UserId;
  readonly skillId: SkillId;
  readonly skillVersionId: SkillVersionId | null;
  readonly harnessVersionId: HarnessVersionId | null;
  readonly verdict: SafetyReviewVerdict;
  readonly result: SafetyReviewResult;
  readonly createdAt: Date;
};
