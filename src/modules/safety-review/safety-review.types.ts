import type { Skill } from "@/modules/skill";
import type { Artifact, Insight } from "@/modules/skill-analysis";

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
