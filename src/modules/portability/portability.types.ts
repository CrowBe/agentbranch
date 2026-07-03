import type { ModelSelection } from "@/modules/model-router";
import type { Skill } from "@/modules/skill";
import type { Artifact, Insight } from "@/modules/skill-analysis";
import type { CaseResult } from "@/modules/triggering-eval";

/**
 * A named runtime target for cross-runtime validation.
 *
 * `modelSelection` stays server-side; rendered results expose only the target's
 * user-facing label and pass/fail state, never raw model ids.
 */
export type RuntimeTarget = {
  readonly id: string;
  readonly label: string;
  readonly modelSelection: ModelSelection;
};

export type RuntimeTargetResult =
  | {
      readonly targetId: string;
      readonly label: string;
      readonly status: "passed" | "failed";
      readonly cases: readonly CaseResult[];
    }
  | {
      readonly targetId: string;
      readonly label: string;
      readonly status: "not_configured";
      readonly message: string;
    };

export type CrossRuntimeValidationInput = {
  readonly skill: Skill;
  readonly targets: readonly RuntimeTarget[];
};

/**
 * Cross-runtime validation's evaluation result: the same triggering battery run
 * against selected runtime targets, reported as an honest per-target grid.
 */
export type CrossRuntimeValidationResult = Artifact<"cross-runtime-validation"> & {
  readonly targets: readonly RuntimeTargetResult[];
  readonly insight: Insight;
};

export type CrossRuntimeValidationBreakdown = {
  readonly targets: readonly RuntimeTargetResult[];
};
