import type { PublicationId, SafetyRatingId, SkillId, SkillVersionId, UserId } from "@/shared";
import type { SkillSource } from "@/modules/skill";

/** Visibility tier for a published skill version (ARCHITECTURE §9.1). */
export type PublicationTier = "private" | "published" | "reviewed";

export type PublicationSafetyState =
  | {
      readonly status: "safety-badge";
      readonly label: "safety badge";
      readonly ratingId: SafetyRatingId;
    }
  | {
      readonly status: "potentially-unsafe";
      readonly label: "potentially unsafe — not validated";
      readonly ratingId: null;
    };

export type PublicationSafetyRating = {
  readonly skillVersionId: SkillVersionId | null;
  readonly verdict: "passed" | "needs-review" | "blocked";
  readonly ratingId: SafetyRatingId;
};

export type PublicationSlug = {
  readonly owner: string;
  readonly name: string;
};

export type Publication = {
  readonly id: PublicationId;
  readonly publisherId: UserId;
  readonly skillId: SkillId;
  readonly skillVersionId: SkillVersionId;
  /** Stable `owner/skill-name` address. */
  readonly slug: string;
  readonly tier: PublicationTier;
  readonly contentHash: string;
  readonly createdAt: Date;
};

/** One entry in the public tap's `.claude-plugin/marketplace.json`. */
export type TapMarketplaceSkill = {
  /** Install-by-name identity, matching the publication slug's skill name. */
  readonly name: string;
  /** Publisher namespace from the stable `owner/name` address. */
  readonly owner: string;
  readonly slug: string;
  readonly tier: PublicationTier;
  readonly contentHash: string;
  readonly safety: PublicationSafetyState;
  /** Skills install from the tap repository at HEAD; takedown is a revert. */
  readonly source: {
    readonly type: "git";
    readonly ref: "HEAD";
    readonly path: string;
  };
};

/** The tap repository marketplace file shape. */
export type TapMarketplaceManifest = {
  readonly version: 1;
  readonly skills: readonly TapMarketplaceSkill[];
};

export type TapRepositorySkill = {
  readonly publication: Publication;
  readonly source: SkillSource;
};

export type TapRepositoryFile = {
  readonly path: string;
  readonly content: string;
};

export type PublishSkillVersionInput = {
  readonly publisherId: UserId;
  readonly skillId: SkillId;
  readonly skillVersionId: SkillVersionId;
  readonly slug: PublicationSlug;
  readonly tier: PublicationTier;
  readonly contentHash: string;
};
