import type { HarnessVersionId, PublicationId, SkillId, SkillVersionId, UserId } from "@/shared";

/** Visibility tier for a published skill version (ARCHITECTURE §9.1). */
export type PublicationTier = "private" | "community" | "reviewed";

export type PublicationGateVerdict = "passed" | "failed";

export type PublicationGateBinding = {
  readonly verdict: PublicationGateVerdict;
  /** The recorded automated gate run that reviewed this exact version. */
  readonly gateRunId: string;
  /** The validation harness identity that produced the verdict. */
  readonly harnessVersionId: HarnessVersionId;
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
  readonly gate: PublicationGateBinding;
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
  readonly gate: PublicationGateBinding;
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

export type PublishSkillVersionInput = {
  readonly publisherId: UserId;
  readonly skillId: SkillId;
  readonly skillVersionId: SkillVersionId;
  readonly slug: PublicationSlug;
  readonly tier: PublicationTier;
  readonly contentHash: string;
  readonly gate: PublicationGateBinding;
};
