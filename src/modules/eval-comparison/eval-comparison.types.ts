import type {
  EvalRunId,
  HarnessVersionId,
  SkillBranchId,
  SkillId,
  SkillVersionId,
} from "@/shared";

export type EvalComparisonReason =
  | "run-not-found-or-not-owned"
  | "same-run"
  | "legacy-metadata"
  | "different-skill"
  | "missing-version"
  | "missing-branch"
  | "different-evaluation-set"
  | "empty-case-set"
  | "different-case-order"
  | "different-attempts"
  | "different-grader"
  | "different-method"
  | "different-harness";

export type EvalComparisonIdentity = {
  readonly runId: EvalRunId;
  readonly skillVersionId: SkillVersionId;
  readonly branchId: SkillBranchId;
  readonly harnessVersionId: HarnessVersionId;
};

export type EvalCaseComparison = {
  readonly caseId: string;
  readonly leftRate: number;
  readonly rightRate: number;
  /** Always right - left. */
  readonly delta: number;
};

export type EvalRunComparison =
  | {
      readonly comparable: false;
      readonly reason: EvalComparisonReason;
      readonly leftRunId: EvalRunId;
      readonly rightRunId: EvalRunId;
      readonly methodVersion: 1;
    }
  | {
      readonly comparable: true;
      readonly method: "paired-case-cluster-bootstrap";
      readonly methodVersion: 1;
      readonly confidence: 0.95;
      readonly seed: number;
      readonly resamples: 10_000;
      readonly skillId: SkillId;
      readonly evaluationSetHash: string;
      readonly left: EvalComparisonIdentity;
      readonly right: EvalComparisonIdentity;
      readonly cases: readonly EvalCaseComparison[];
      readonly aggregate: {
        readonly delta: number;
        readonly lower: number;
        readonly upper: number;
      };
      readonly verdict: "improved" | "regressed" | "not-distinguishable";
    };
